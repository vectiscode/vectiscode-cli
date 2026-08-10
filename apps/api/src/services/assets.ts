import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { customAlphabet } from "nanoid";
import { deflateSync, inflateSync } from "node:zlib";
import type { Attachment } from "../types.js";
import { GENERATED_ICON_OUTPUT_SIZE, config } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger({ service: "assets" });

const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 12);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 600;
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/x-lua",
  "application/yaml",
  "application/x-yaml",
  "application/toml"
]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "csv", "lua", "luau", "yml", "yaml", "toml"]);
const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "scr",
  "ps1",
  "msi",
  "apk",
  "app",
  "dmg",
  "pkg",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz"
]);

const TRANSPARENT_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_INLINE_ATTACHMENT_BYTES = 650 * 1024;
let cachedSupabaseStorage: SupabaseClient | undefined;

export class AttachmentStorageUnavailableError extends Error {
  constructor(message = "Attachment storage is not available right now.") {
    super(message);
    this.name = "AttachmentStorageUnavailableError";
  }
}

export function isAttachmentStorageUnavailableError(error: unknown) {
  return error instanceof AttachmentStorageUnavailableError;
}

function safeFileName(fileName: string) {
  const trimmed = fileName.trim().replace(/[/\\]/g, "-").replace(/[^\w.\- ]+/g, "").slice(0, 120);
  return trimmed || "attachment";
}

function extensionFor(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1]?.toLowerCase() ?? "";
}

function looksLikeWindowsExecutable(bytes: Buffer) {
  return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

export function validateUploadedAsset(input: { fileName: string; mimeType: string; bytes: Buffer }) {
  const fileName = safeFileName(input.fileName);
  const ext = extensionFor(fileName);
  const mimeType = (input.mimeType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const sizeBytes = input.bytes.length;

  if (!sizeBytes) throw new Error("Uploaded file is empty.");
  if (BLOCKED_EXTENSIONS.has(ext) || looksLikeWindowsExecutable(input.bytes)) {
    throw new Error("Executable files and archives are not allowed.");
  }

  if (mimeType.startsWith("image/")) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
      throw new Error("Only PNG, JPEG, and WebP images are supported.");
    }
    if (sizeBytes > MAX_IMAGE_BYTES) throw new Error("Images are limited to 10 MB.");
    return { fileName, mimeType, sizeBytes, kind: "image" as const };
  }

  if (mimeType === "application/pdf" || ext === "pdf") {
    if (sizeBytes > MAX_PDF_BYTES) throw new Error("PDF files are limited to 10 MB.");
    return { fileName, mimeType: "application/pdf", sizeBytes, kind: "pdf" as const };
  }

  if (TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(ext)) {
    if (sizeBytes > MAX_TEXT_BYTES) throw new Error("Text and code files are limited to 2 MB.");
    const normalizedMime = TEXT_MIME_TYPES.has(mimeType) ? mimeType : "text/plain";
    return { fileName, mimeType: normalizedMime, sizeBytes, kind: "text" as const };
  }

  throw new Error("That file type is not supported yet.");
}

function parseStoragePath(storagePath: string) {
  if (storagePath.startsWith("supabase://")) {
    const withoutScheme = storagePath.slice("supabase://".length);
    const slash = withoutScheme.indexOf("/");
    if (slash < 0) return { objectName: withoutScheme };
    return {
      bucketName: withoutScheme.slice(0, slash),
      objectName: withoutScheme.slice(slash + 1)
    };
  }
  if (!storagePath.startsWith("gs://")) return { objectName: storagePath };
  const withoutScheme = storagePath.slice("gs://".length);
  const slash = withoutScheme.indexOf("/");
  if (slash < 0) return { objectName: withoutScheme };
  return {
    bucketName: withoutScheme.slice(0, slash),
    objectName: withoutScheme.slice(slash + 1)
  };
}

function supabaseStorageClient() {
  if (!config.supabase.url || !config.supabase.serviceKey) {
    throw new AttachmentStorageUnavailableError("Supabase Storage is not configured.");
  }
  cachedSupabaseStorage ??= createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  return cachedSupabaseStorage;
}

async function saveSupabaseObject(input: {
  bucketName: string;
  objectName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const { error } = await supabaseStorageClient()
    .storage
    .from(input.bucketName)
    .upload(input.objectName, input.bytes, {
      contentType: input.mimeType,
      upsert: false
    });
  if (error) {
    throw new AttachmentStorageUnavailableError(`Could not save attachment bytes in Supabase Storage: ${error.message}`);
  }
}

async function downloadSupabaseObject(bucketName: string, objectName: string) {
  const { data, error } = await supabaseStorageClient()
    .storage
    .from(bucketName)
    .download(objectName);
  if (error || !data) {
    log.warn("Could not read Supabase Storage object", { objectName, error: String(error) });
    return undefined;
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function persistAttachmentBytes(input: {
  organizationId: string;
  projectId: string;
  threadId?: string;
  messageId?: string;
  userId: string;
  source: Attachment["source"];
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  inlineText?: string;
  prompt?: string;
  creditsCharged?: number;
}): Promise<Attachment> {
  const id = `asset_${nanoid()}`;
  const fileName = safeFileName(input.fileName);
  let storagePath: string | undefined;
  let inlineBase64: string | undefined;
  let inlineText = input.inlineText;

  if (config.useSupabase) {
    const bucketName = config.supabase.storageBucket;
    const objectName = `attachments/${input.organizationId}/${input.projectId}/${id}-${fileName}`;
    storagePath = `supabase://${bucketName}/${objectName}`;
    await saveSupabaseObject({
      bucketName,
      objectName,
      mimeType: input.mimeType,
      bytes: input.bytes
    });
  } else {
    if (config.isProduction && input.bytes.length > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new AttachmentStorageUnavailableError(
        "Supabase Storage is required for production attachments above 650 KB."
      );
    }
    inlineBase64 = input.bytes.toString("base64");
    if (!inlineText && input.mimeType.startsWith("text/")) {
      inlineText = input.bytes.toString("utf8").slice(0, 80_000);
    }
  }

  return {
    id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    threadId: input.threadId,
    messageId: input.messageId,
    userId: input.userId,
    source: input.source,
    fileName,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    storagePath,
    inlineText,
    inlineBase64,
    prompt: input.prompt,
    creditsCharged: input.creditsCharged,
    createdAt: new Date().toISOString()
  };
}

export async function readAttachmentBytes(attachment: Attachment) {
  if (attachment.inlineBase64) return Buffer.from(attachment.inlineBase64, "base64");
  if (!attachment.storagePath) return undefined;
  const parsed = parseStoragePath(attachment.storagePath);
  if (attachment.storagePath.startsWith("supabase://")) {
    if (!parsed.bucketName || !parsed.objectName) return undefined;
    return downloadSupabaseObject(parsed.bucketName, parsed.objectName);
  }
  if (attachment.storagePath.startsWith("gs://")) {
    return undefined;
  }
  return undefined;
}

export async function getAttachmentSignedUrl(attachment: Attachment, expiresInSeconds = 60) {
  if (!attachment.storagePath || !attachment.storagePath.startsWith("supabase://")) {
    return undefined;
  }
  const parsed = parseStoragePath(attachment.storagePath);
  if (!parsed.bucketName || !parsed.objectName) return undefined;

  try {
    const { data, error } = await supabaseStorageClient()
      .storage
      .from(parsed.bucketName)
      .createSignedUrl(parsed.objectName, expiresInSeconds);
    if (error || !data) {
      log.warn("Could not create signed URL from Supabase Storage", { objectName: parsed.objectName, error: String(error) });
      return undefined;
    }
    return data.signedUrl;
  } catch (err) {
    log.error("Error creating signed URL from Supabase Storage", { objectName: parsed.objectName, error: String(err) });
    return undefined;
  }
}

export async function deleteAttachmentBytes(attachment: Attachment) {
  if (!attachment.storagePath || !attachment.storagePath.startsWith("supabase://")) return;
  const parsed = parseStoragePath(attachment.storagePath);
  if (parsed.bucketName && parsed.objectName) {
    try {
      const { error } = await supabaseStorageClient()
        .storage
        .from(parsed.bucketName)
        .remove([parsed.objectName]);
      if (error) {
        log.warn("Could not remove object from Supabase Storage during deletion", { objectName: parsed.objectName, error: error.message });
      }
    } catch (err) {
      log.warn("Error removing object from Supabase Storage during deletion", { objectName: parsed.objectName, error: String(err) });
    }
  }
}

export function attachmentPromptContext(attachments: Attachment[]) {
  if (attachments.length === 0) return "";
  return [
    "ATTACHMENTS:",
    ...attachments.map((attachment, index) => {
      const head = `${index + 1}. ${attachment.fileName} (${attachment.mimeType}, ${Math.ceil(attachment.sizeBytes / 1024)} KB)`;
      if (attachment.inlineText) {
        return `${head}\n${attachment.inlineText.slice(0, 6000)}`;
      }
      if (attachment.mimeType.startsWith("image/")) {
        return `${head}\nThis image must be delivered as native multimodal input or analyzed into a visible visual brief. If neither happened, explicitly tell the user it was not analyzed.`;
      }
      if (attachment.mimeType === "application/pdf") return `${head}\nPDF text extraction is unavailable for this attachment. Do not claim to have read its pages.`;
      return `${head}\nThis attachment has no extracted content. Do not claim to have read it.`;
    })
  ].join("\n\n");
}

export function normalizeIconPrompt(prompt: string) {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new Error("Icon prompt is required.");
  if (trimmed.length > MAX_PROMPT_LENGTH) throw new Error("Icon prompt is too long.");
  return trimmed;
}

function paethPredictor(left: number, up: number, upperLeft: number) {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upperLeft;
}

function unfilterPngScanlines(input: Buffer, height: number, bytesPerPixel: number, rowBytes: number) {
  const output = Buffer.alloc(rowBytes * height);
  let inputOffset = 0;
  let outputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filterType = input[inputOffset++];
    for (let x = 0; x < rowBytes; x++) {
      const raw = input[inputOffset++];
      const left = x >= bytesPerPixel ? output[outputOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[outputOffset + x - rowBytes] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? output[outputOffset + x - rowBytes - bytesPerPixel] : 0;
      let value = raw;

      if (filterType === 1) value = raw + left;
      else if (filterType === 2) value = raw + up;
      else if (filterType === 3) value = raw + Math.floor((left + up) / 2);
      else if (filterType === 4) value = raw + paethPredictor(left, up, upperLeft);
      else if (filterType !== 0) throw new Error("Unsupported PNG filter.");

      output[outputOffset + x] = value & 0xff;
    }
    outputOffset += rowBytes;
  }

  return output;
}

function pngHasTransparentPixels(bytes: Buffer) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let trnsChunk: Buffer | undefined;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    const chunkData = bytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "tRNS") {
      trnsChunk = chunkData;
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!width || !height) return false;
  if (colorType !== 4 && colorType !== 6) return Boolean(trnsChunk?.some((value) => value < 255));
  if (bitDepth !== 8 && bitDepth !== 16) return false;
  if (idatChunks.length === 0) return false;

  try {
    const channels = colorType === 6 ? 4 : 2;
    const bytesPerSample = bitDepth / 8;
    const bytesPerPixel = channels * bytesPerSample;
    const rowBytes = width * bytesPerPixel;
    const pixels = unfilterPngScanlines(inflateSync(Buffer.concat(idatChunks)), height, bytesPerPixel, rowBytes);
    const alphaOffset = (channels - 1) * bytesPerSample;

    for (let row = 0; row < height; row++) {
      const rowOffset = row * rowBytes;
      for (let x = 0; x < width; x++) {
        const index = rowOffset + x * bytesPerPixel + alphaOffset;
        if (bitDepth === 8 && pixels[index] < 255) return true;
        if (bitDepth === 16 && (pixels[index] < 255 || pixels[index + 1] < 255)) return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function makeCrcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");

  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcValue = crc32(typeAndData);

  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crcValue, 0);

  return Buffer.concat([header, data, footer]);
}

function buildPngBuffer(width: number, height: number, idatData: Buffer): Buffer {
  const chunks: Buffer[] = [PNG_SIGNATURE];

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  chunks.push(createChunk("IHDR", ihdrData));

  chunks.push(createChunk("IDAT", idatData));
  chunks.push(createChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function decodeRgbaPng(bytes: Buffer): { width: number; height: number; rgba: Buffer } | undefined {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    const chunkData = bytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!width || !height || bitDepth !== 8 || ![2, 4, 6].includes(colorType) || idatChunks.length === 0) {
    return undefined;
  }

  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : 3;
  const rowBytes = width * channels;
  const pixels = unfilterPngScanlines(inflateSync(Buffer.concat(idatChunks)), height, channels, rowBytes);
  const rgba = Buffer.alloc(width * height * 4);

  for (let source = 0, dest = 0; source < pixels.length; source += channels, dest += 4) {
    if (colorType === 4) {
      rgba[dest] = pixels[source];
      rgba[dest + 1] = pixels[source];
      rgba[dest + 2] = pixels[source];
      rgba[dest + 3] = pixels[source + 1];
    } else {
      rgba[dest] = pixels[source];
      rgba[dest + 1] = pixels[source + 1];
      rgba[dest + 2] = pixels[source + 2];
      rgba[dest + 3] = colorType === 6 ? pixels[source + 3] : 255;
    }
  }

  return { width, height, rgba };
}

function encodeRgbaPng(width: number, height: number, rgba: Buffer) {
  const filtered = Buffer.alloc(height * (1 + width * 4));
  let dest = 0;
  let source = 0;
  for (let y = 0; y < height; y++) {
    filtered[dest++] = 0;
    for (let x = 0; x < width; x++) {
      filtered[dest++] = rgba[source++];
      filtered[dest++] = rgba[source++];
      filtered[dest++] = rgba[source++];
      filtered[dest++] = rgba[source++];
    }
  }
  return buildPngBuffer(width, height, deflateSync(filtered));
}

function rgbDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function edgePixelIndexes(width: number, height: number) {
  const indexes: number[] = [];
  for (let x = 0; x < width; x++) {
    indexes.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    indexes.push(y * width, y * width + width - 1);
  }
  return indexes;
}

function quantizeColor(r: number, g: number, b: number) {
  return `${Math.round(r / 16)},${Math.round(g / 16)},${Math.round(b / 16)}`;
}

function sampledBackgroundColors(width: number, height: number, rgba: Buffer) {
  const counts = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const pixel of edgePixelIndexes(width, height)) {
    const offset = pixel * 4;
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const key = quantizeColor(r, g, b);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      counts.set(key, { count: 1, r, g, b });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((item) => ({
      r: Math.round(item.r / item.count),
      g: Math.round(item.g / item.count),
      b: Math.round(item.b / item.count),
      count: item.count
    }));
}

function looksLikeFakeTransparencyGrid(width: number, height: number, rgba: Buffer) {
  const colors = sampledBackgroundColors(width, height, rgba);
  const edgeCount = edgePixelIndexes(width, height).length;
  const neutralEdgeShare = colors
    .filter((color) => saturation(color.r, color.g, color.b) < 0.16)
    .reduce((sum, color) => sum + color.count, 0) / Math.max(1, edgeCount);
  const hasDarkNeutral = colors.some((color) => saturation(color.r, color.g, color.b) < 0.16 && Math.max(color.r, color.g, color.b) < 80);
  const hasLightNeutral = colors.some((color) => saturation(color.r, color.g, color.b) < 0.16 && Math.min(color.r, color.g, color.b) > 150);
  return neutralEdgeShare > 0.45 && hasDarkNeutral && hasLightNeutral;
}

function cutoutBackground(bytes: Buffer): Buffer {
  try {
    const decoded = decodeRgbaPng(bytes);
    if (!decoded) return bytes;

    const { width, height, rgba } = decoded;
    const backgroundColors = sampledBackgroundColors(width, height, rgba);
    const removed = new Uint8Array(width * height);
    const queue: number[] = [];

    const isChromaKey = (r: number, g: number, b: number) =>
      g > 170 && r < 90 && b < 110 && g - Math.max(r, b) > 80;

    const matchesBackground = (pixel: number) => {
      const offset = pixel * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const a = rgba[offset + 3];
      if (a < 16) return true;
      if (isChromaKey(r, g, b)) return true;
      return backgroundColors.some((color) => {
        const distance = rgbDistance(r, g, b, color.r, color.g, color.b);
        const neutral = saturation(color.r, color.g, color.b) < 0.18 && saturation(r, g, b) < 0.22;
        return distance < (neutral ? 74 : 48);
      });
    };

    const enqueue = (pixel: number) => {
      if (pixel < 0 || pixel >= removed.length || removed[pixel]) return;
      if (!matchesBackground(pixel)) return;
      removed[pixel] = 1;
      queue.push(pixel);
    };

    for (const pixel of edgePixelIndexes(width, height)) enqueue(pixel);

    for (let head = 0; head < queue.length; head += 1) {
      const pixel = queue[head];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x > 0) enqueue(pixel - 1);
      if (x < width - 1) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y < height - 1) enqueue(pixel + width);
    }

    for (let pixel = 0; pixel < removed.length; pixel += 1) {
      if (removed[pixel]) {
        rgba[pixel * 4 + 3] = 0;
      }
    }

    return encodeRgbaPng(width, height, rgba);
  } catch (err) {
    log.error("cutoutBackground error", { error: String(err) });
    return bytes;
  }
}

function postProcessGeneratedIcon(bytes: Buffer): Buffer {
  const decoded = decodeRgbaPng(bytes);
  if (!decoded) return bytes;
  if (!pngHasTransparentPixels(bytes) || looksLikeFakeTransparencyGrid(decoded.width, decoded.height, decoded.rgba)) {
    return cutoutBackground(bytes);
  }
  return bytes;
}

function assertTransparentPng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Image generation did not return a PNG.");
  }
  if (!pngHasTransparentPixels(bytes)) {
    throw new Error("Generated icon was not transparent. Please try a more specific icon prompt.");
  }
}

function requestedTextDirective(safePrompt: string) {
  if (/\b(no|without|remove|omit)\s+(text|words?|letters?|label|caption|title)\b|\btextless\b/i.test(safePrompt)) {
    return "Do not include any letters, words, labels, captions, tiny text, fake UI text, or unreadable glyphs.";
  }

  const textMatch = /\b(?:text|label|caption|title|says?|wording|with words?)\s*(?:called|of|as|:|-)?\s*["']?([A-Za-z0-9][A-Za-z0-9 ]{1,22})["']?/i.exec(safePrompt);
  const explicitTextRequest = /\b(text|label|caption|title|says?|wording|with words?)\b/i.test(safePrompt);
  const upperWords = explicitTextRequest ? (safePrompt.match(/\b[A-Z0-9]{3,12}\b/g) ?? []) : [];
  const label = textMatch?.[1]?.trim().replace(/\s+/g, " ").slice(0, 24) || upperWords[0];
  if (!label) {
    return "Do not include any letters, words, labels, captions, tiny text, fake UI text, or unreadable glyphs unless the request explicitly asks for text.";
  }

  return [
    `Include the exact readable label "${label}" as large white block letters with a thick black outline.`,
    "Keep the lettering short, centered near the bottom, and legible at app icon size.",
    "Do not invent extra words, fake letters, or tiny unreadable text."
  ].join(" ");
}

function iconIntentDirective(safePrompt: string) {
  const lower = safePrompt.toLowerCase();
  const wantsBrainrot = /\bbrainrot\b/.test(lower);
  const wantsRebirth = /\brebirth\b/.test(lower);
  const forbidsText = /\b(no|without|remove|omit)\s+(text|words?|letters?|label|caption|title)\b|\btextless\b/i.test(safePrompt);

  if (wantsBrainrot && wantsRebirth) {
    return [
      "This is a vibrant Roblox brainrot rebirth game icon, designed in a premium viral simulator sticker style.",
      "Target look: a glossy hot-pink square or rounded-square plastic toy tile with subtle raised Roblox-like studs, a thick bold black outline, and high-energy glossy highlights.",
      "The central symbol must be a highly cartoonish, glowing, goofy brain character with a funny derp face (googly eyes, silly grin, tongue sticking out) set inside a glowing circular neon-cyan rebirth/recycle refresh arrow loop.",
      "Surround the central goofy brain character with high-contrast, playful cartoon sparkles, yellow stars, and micro-lightning bolt aura effects to emphasize a crazy power upgrade.",
      forbidsText
        ? "The design must be completely text-free with no letters or captions."
        : "Keep it completely text-free unless a specific label is requested.",
      "Avoid standard boring rebirth arrows, literal anatomical brains, realistic organs, phoenixes, wings, fire, and complex landscape backgrounds."
    ].join(" ");
  }

  if (wantsBrainrot) {
    return [
      "This is a Roblox brainrot game icon in viral simulator style, not literal anatomy and not fantasy art.",
      "Use a funny simplified meme-game object or goofy face with chunky shapes, thick black outline, glossy toy lighting, saturated pink or candy colors, and strong app-icon readability.",
      "Avoid realistic brains, medical anatomy, phoenixes, birds, wings, fire creatures, galaxy emblems, and detailed fantasy logos."
    ].join(" ");
  }

  if (wantsRebirth) {
    return [
      "This is a Roblox simulator rebirth icon.",
      "Use a bold red upward arrow, refresh loop, or rebirth swirl on a bright pink tile, with thick black outlines and glossy game UI lighting.",
      forbidsText ? "Keep it text-free." : "Do not add text unless the request explicitly asks for a label.",
      "Avoid phoenixes, birds, wings, fantasy fire creatures, and ornate magic emblems."
    ].join(" ");
  }

  return "";
}

function brainrotStyleDirective(safePrompt: string) {
  if (!/\bbrainrot|rebirth|roblox|obby|simulator|tycoon\b/i.test(safePrompt)) return "";
  return [
    "Use trendy Roblox simulator icon styling, not fantasy concept art.",
    "Composition target: simple bold mascot or symbol, chunky sticker shapes, thick black outlines, glossy highlights, and high contrast.",
    "Prefer a clean Roblox game-button icon over a detailed illustration.",
    "Avoid phoenixes, birds, wings, galaxy wings, generic magic emblems, realistic anatomy, and over-detailed fantasy logos."
  ].join(" ");
}

export function iconGenerationPrompt(safePrompt: string, attempt = 0) {
  const instructions = [
    "Create exactly one professional Roblox game UI icon.",
    "The final asset will be cut out after generation. Put all empty outside area on a perfectly flat solid chroma key green background #00FF00.",
    "The #00FF00 area must touch all four image edges and contain no texture, noise, shadows, checkerboard squares, border, gradient, or pattern.",
    "Do not draw a transparency checkerboard, gray checker grid, black checker grid, fake alpha pattern, photo background, watermark, UI mockup, or multiple icons.",
    "A square or rounded-square badge can be part of the icon when it helps match the request, but leave clear chroma key green outside the badge.",
    "Use a crisp readable silhouette, polished game asset lighting, high contrast, chunky shapes, thick outline, and concrete visual details that match the request.",
    "The icon must remain recognizable in a small Roblox HUD button or game thumbnail.",
    iconIntentDirective(safePrompt),
    requestedTextDirective(safePrompt),
    brainrotStyleDirective(safePrompt),
    `Icon request: ${safePrompt}`
  ].filter(Boolean);
  if (attempt > 0) {
    instructions.splice(2, 0, "This is a retry because the previous result failed cutout validation. Use a plain green-screen product render. Keep the outside background pure #00FF00 with no checkerboard, no texture, no shadows, and no invented text.");
  }
  return instructions.join(" ");
}

export async function generateTransparentIcon(prompt: string) {
  normalizeIconPrompt(prompt);
  if (!config.isProduction) return Buffer.from(TRANSPARENT_PIXEL_PNG, "base64");
  throw new Error("Generated icons are disabled until a non-Google image provider is configured.");
}
