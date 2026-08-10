import { customAlphabet } from "nanoid";
const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 12);
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, User as SupabaseAuthUser } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";
import type {
  AiCache,
  AiMessage,
  ApplyResult,
  AuthSession,
  ChangeSet,
  CreditLedger,
  Attachment,
  CustomerEvidenceEvent,
  Organization,
  Project,
  ProjectMember,
  ProjectSnapshot,
  StudioSnapshotChunk,
  ProjectTemplate,
  StripeProcessedEvent,
  StudioLog,
  StudioObservation,
  StudioSession,
  StudioTaskRun,
  Thread,
  UsageStats,
  User,
  ModelEvaluationRun,
  TaskPlan,
  PatchComment,
  AgentRun,
  AgentArtifact,
  DesignProfile,
  ProjectContextIndex
} from "../types.js";
import { config } from "./config.js";
import { normalizePlanName, planFor } from "./plans.js";
import { deleteAttachmentBytes } from "./assets.js";
import { buildProjectContextIndex } from "./contextIndex.js";

const log = createLogger({ service: "store" });
const SUPABASE_COLLECTION_PAGE_SIZE = 1000;
const allowedJsonQueryFields: Record<string, Set<string>> = {
  users: new Set(["id", "robloxUserId", "googleUserId", "authProvider", "email", "supabaseUserId"]),
  organizations: new Set(["id", "stripeCustomerId", "stripeSubscriptionId"]),
  members: new Set(["id", "userId", "organizationId"]),
  projects: new Set(["id", "organizationId"]),
  sessions: new Set(["id", "status", "userId", "projectId"]),
  authSessions: new Set(["id", "userId", "expiresAt"]),
  threads: new Set(["id", "projectId", "userId"]),
  messages: new Set(["id", "threadId", "projectId"]),
  changeSets: new Set(["id", "threadId", "projectId", "changeSetId"]),
  attachments: new Set(["id", "projectId", "threadId", "organizationId", "userId"]),
  applyResults: new Set(["id", "changeSetId"]),
  ledger: new Set(["id", "organizationId"]),
  logs: new Set(["id", "studioSessionId"]),
  studioTaskRuns: new Set(["id", "projectId", "changeSetId"]),
  studioObservations: new Set(["id", "taskRunId", "projectId"]),
  snapshots: new Set(["id", "projectId"]),
  snapshotChunks: new Set(["id", "uploadId", "projectId", "expiresAt"]),
  customerEvidence: new Set(["id", "userId", "organizationId", "projectId", "type"]),
  ai_caches: new Set(["id", "snapshotId", "modelId"]),
  taskPlans: new Set(["id", "projectId", "threadId"]),
  patchComments: new Set(["id", "projectId", "changeSetId"]),
  stripeProcessedEvents: new Set(["id", "stripeEventId", "stripeSessionId"]),
  evaluations: new Set(["id"]),
  emailSubscribers: new Set(["id", "email"]),
  agentRuns: new Set(["id", "projectId", "threadId", "userId", "status"]),
  agentArtifacts: new Set(["id", "projectId", "runId", "expiresAt"]),
  designProfiles: new Set(["id", "projectId"]),
  contextIndexes: new Set(["id", "projectId", "snapshotId"])
};

const now = () => new Date().toISOString();
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const planRank = { free: 0, starter: 1, pro: 2, studio: 3 };
const STRIPE_PROCESSING_RECLAIM_MS = 15 * 60 * 1000;

function duplicateUserCanonicalRank(user: User) {
  if (user.authProvider === "google" || user.googleUserIds?.length) return 0;
  if (user.authProvider === "supabase" || user.supabaseUserId) return 1;
  if (user.authProvider === "roblox" || user.robloxUserId) return 2;
  if (user.authProvider === "firebase" || user.googleUserId) return 3;
  return 4;
}

interface SupabaseRegisteredUser {
  supabaseUserId: string;
  email?: string;
  name: string;
  avatarUrl?: string;
  createdAt: string;
  lastSignInAt?: string;
}

interface CollectionPageCursor {
  createdAt: string;
  id: string;
}

function encodeCollectionCursor(cursor: CollectionPageCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCollectionCursor(value?: string): CollectionPageCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CollectionPageCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[A-Za-z0-9:_-]{1,160}$/.test(parsed.id)
    ) {
      return undefined;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

function monthWindow(reference = new Date()) {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { start, end };
}

function isUsageDebit(entry: CreditLedger) {
  return entry.delta < 0 && /(AI response|Project context answer|Plan Mode response|Luau Guard review|Generated reviewable Roblox change set|Generated transparent icon|Studio sync metering|Reserved AI response|Reserved edited AI response|Reserved reviewable Roblox change set|Reserved edited Roblox change set|Approved Task Plan implementation)/i.test(entry.reason);
}

function isUsageRefund(entry: CreditLedger) {
  return entry.delta > 0 && /(Refund for rejected change set|Refund unused AI reservation|Refund unused Task Plan reservation|Refund for failed generated transparent icon|Admin usage reset)/i.test(entry.reason);
}

function isMonthlyExtraCredit(entry: CreditLedger) {
  return isPaidExtraCredit(entry) || isAdminGrantCredit(entry) || isAdminAdjustmentCredit(entry);
}

function isPaidExtraCredit(entry: CreditLedger) {
  return entry.delta > 0 && /top-up/i.test(entry.reason);
}

function isAdminGrantCredit(entry: CreditLedger) {
  return entry.delta > 0 && /(Admin credit grant|Admin balance grant)/i.test(entry.reason);
}

function isAdminAdjustmentCredit(entry: CreditLedger) {
  return entry.delta > 0 && /Admin usage adjustment/i.test(entry.reason);
}

function publicSignupClosedError() {
  return Object.assign(new Error("Public signups are temporarily closed."), {
    statusCode: 403
  });
}

function jsonField(collection: string, field: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field) || !allowedJsonQueryFields[collection]?.has(field)) {
    throw new Error(`Unsupported query field ${collection}.${field}`);
  }
  return `data->>${field}`;
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

/**
 * Professional granular store.
 * Uses Supabase rows in production and local JSON files for development/test fallback.
 */
export class PersistentStore {
  supabase?: SupabaseClient;
  private hydrated = false;
  private hydratePromise?: Promise<void>;
  private localLocks = new Map<string, Promise<void>>();
  
  // Local file fallback for dev
  private readonly persistToDisk = !config.isProduction && config.allowLocalFileStore && !config.useSupabase;
  private readonly dataDir = process.env.NODE_ENV === "test"
    ? path.join(process.cwd(), "data", `collections_test_${process.pid}`)
    : path.join(process.cwd(), "data", "collections");

  onUpdate?: (userId: string) => void;

  constructor() {
    if (this.persistToDisk && !existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async ready() {
    if (!this.hydratePromise) {
      this.hydratePromise = this.init();
    }
    return this.hydratePromise;
  }

  async ping(): Promise<void> {
    if (!config.useSupabase) return;
    await this.ready();
    const { error } = await this.supabase!
      .from("vectis_collections")
      .select("id")
      .limit(1);
    if (error) throw new Error(`Database connectivity check failed: ${error.message}`);
  }

  private async init() {
    if (this.hydrated) return;
    this.hydrated = true;

    if (config.useSupabase) {
      this.initSupabase();
    }
  }

  private initSupabase() {
    if (!this.supabase) {
      this.supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    }
  }

  private sanitize<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  async getDoc<T>(collection: string, id: string): Promise<T | undefined> {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", collection)
        .eq("id", id)
        .maybeSingle();
      if (error) {
        log.error("Error getting document", { collection, id, error: String(error) });
        return undefined;
      }
      return data ? (data.data as T) : undefined;
    }

    if (this.persistToDisk) {
      const file = path.join(this.dataDir, `${collection}_${id}.json`);
      try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    return undefined;
  }

  async createUniqueId(collection: string, prefix: string, length = 18) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = `${prefix}${nanoid(length)}`;
      if (!(await this.getDoc(collection, id))) {
        return id;
      }
    }

    throw new Error(`Could not allocate a unique ${prefix.replace(/_$/, "")} id`);
  }

  async saveDoc<T extends { id: string }>(collection: string, item: T) {
    if (config.useSupabase) {
      const { error } = await this.supabase!
        .from("vectis_collections")
        .upsert({
          id: item.id,
          collection_name: collection,
          data: this.sanitize(item)
        }, {
          onConflict: "id,collection_name"
        });
      if (error) {
        log.error("Error upserting document", { collection, id: item.id, error: String(error) });
        throw error;
      }
      return;
    }

    if (this.persistToDisk) {
      const file = path.join(this.dataDir, `${collection}_${item.id}.json`);
      try {
        writeFileSync(file, JSON.stringify(this.sanitize(item), null, 2));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          mkdirSync(this.dataDir, { recursive: true });
          writeFileSync(file, JSON.stringify(this.sanitize(item), null, 2));
        } else {
          throw err;
        }
      }
    }
  }

  private async insertDocIfAbsent<T extends { id: string }>(collection: string, item: T) {
    if (config.useSupabase) {
      const { error } = await this.supabase!
        .from("vectis_collections")
        .insert({
          id: item.id,
          collection_name: collection,
          data: this.sanitize(item)
        });
      if (error) {
        if (isDuplicateKeyError(error)) return false;
        log.error("Error inserting document", { collection, id: item.id, error: String(error) });
        throw error;
      }
      return true;
    }

    const existing = await this.getDoc<T>(collection, item.id);
    if (existing) return false;
    await this.saveDoc(collection, item);
    return true;
  }

  private async runLocalLock<T>(key: string, task: () => Promise<T>) {
    const previous = this.localLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.localLocks.set(key, previous.then(() => current, () => current));
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.localLocks.get(key) === current) {
        this.localLocks.delete(key);
      }
    }
  }

  private async deleteDoc(collection: string, id: string) {
    if (config.useSupabase) {
      const { error } = await this.supabase!
        .from("vectis_collections")
        .delete()
        .eq("collection_name", collection)
        .eq("id", id);
      if (error) {
        log.error("Error deleting document", { collection, id, error: String(error) });
        throw error;
      }
      return;
    }

    if (this.persistToDisk) {
      const file = path.join(this.dataDir, `${collection}_${id}.json`);
      try {
        unlinkSync(file);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }

  private async deleteDocsByIds(collection: string, ids: string[]) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    if (config.useSupabase) {
      const { error } = await this.supabase!
        .from("vectis_collections")
        .delete()
        .eq("collection_name", collection)
        .in("id", uniqueIds);
      if (error) {
        log.error("Error batch deleting documents", { collection, count: uniqueIds.length, error: String(error) });
      }
      return;
    }
    if (this.persistToDisk) {
      await Promise.all(uniqueIds.map(async (id) => {
        const file = path.join(this.dataDir, `${collection}_${id}.json`);
        try { unlinkSync(file); } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            log.warn("Failed to delete file in batch delete", { file, error: String(err) });
          }
        }
      }));
    }
  }

  private async deleteByField(collection: string, field: string, value: string) {
    const queryField = jsonField(collection, field);
    if (config.useSupabase) {
      const { error } = await this.supabase!
        .from("vectis_collections")
        .delete()
        .eq("collection_name", collection)
        .eq(queryField, value);
      if (error) {
        log.error("Error batch deleting", { collection, field, error: String(error) });
      }
      return;
    }
    if (this.persistToDisk) {
      let files: string[];
      try { files = readdirSync(this.dataDir); } catch { return; }
      for (const file of files) {
        if (!file.startsWith(`${collection}_`) || !file.endsWith(".json")) continue;
        try {
          const doc = JSON.parse(readFileSync(path.join(this.dataDir, file), "utf8"));
          if (doc?.[field] === value) {
            unlinkSync(path.join(this.dataDir, file));
          }
        } catch {
          // ignore corrupt or concurrently deleted file
        }
      }
    }
  }

  private async queryDocs<T>(collection: string, field: string, value: unknown): Promise<T[]> {
    const queryField = jsonField(collection, field);
    if (config.useSupabase) {
      const rows: T[] = [];
      for (let from = 0; ; from += SUPABASE_COLLECTION_PAGE_SIZE) {
        const to = from + SUPABASE_COLLECTION_PAGE_SIZE - 1;
        const { data, error } = await this.supabase!
          .from("vectis_collections")
          .select("data")
          .eq("collection_name", collection)
          .eq(queryField, String(value))
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          log.error("Error querying documents", { collection, field, error: String(error) });
          return [];
        }
        const page = data ?? [];
        rows.push(...page.map(d => d.data as T));
        if (page.length < SUPABASE_COLLECTION_PAGE_SIZE) break;
      }
      return rows;
    }

    // Simple local scanning for dev
    if (this.persistToDisk) {
      let files: string[];
      try { files = readdirSync(this.dataDir); } catch { return []; }
      const results: T[] = [];
      for (const f of files) {
        if (f.startsWith(`${collection}_`)) {
          try {
            const data = JSON.parse(readFileSync(path.join(this.dataDir, f), "utf8"));
            if (data[field] === value) results.push(data);
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
        }
      }
      return results;
    }
    return [];
  }

  async fetchAllDocs<T>(collection: string): Promise<T[]> {
    if (config.useSupabase) {
      const rows: T[] = [];
      for (let from = 0; ; from += SUPABASE_COLLECTION_PAGE_SIZE) {
        const to = from + SUPABASE_COLLECTION_PAGE_SIZE - 1;
        const { data, error } = await this.supabase!
          .from("vectis_collections")
          .select("data")
          .eq("collection_name", collection)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          log.error("Error fetching all documents", { collection, error: String(error) });
          return [];
        }
        const page = data ?? [];
        rows.push(...page.map(d => d.data as T));
        if (page.length < SUPABASE_COLLECTION_PAGE_SIZE) break;
      }
      return rows;
    }

    if (this.persistToDisk) {
      let files: string[];
      try { files = readdirSync(this.dataDir); } catch { return []; }
      const results: T[] = [];
      for (const file of files) {
        if (file.startsWith(`${collection}_`)) {
          try {
            results.push(JSON.parse(readFileSync(path.join(this.dataDir, file), "utf8")) as T);
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
        }
      }
      return results;
    }

    return [];
  }

  async fetchRecentDocs<T>(collection: string, requestedLimit = 2000): Promise<T[]> {
    const limit = Math.min(Math.max(1, Math.trunc(requestedLimit)), 5000);
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", collection)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) {
        log.error("Error fetching recent documents", { collection, error: String(error) });
        return [];
      }
      return (data ?? []).map((row) => row.data as T);
    }

    const docs = await this.fetchAllDocs<T>(collection);
    return docs
      .sort((left, right) => {
        const leftDoc = left as { createdAt?: string; id?: string };
        const rightDoc = right as { createdAt?: string; id?: string };
        return (rightDoc.createdAt ?? "").localeCompare(leftDoc.createdAt ?? "") ||
          (rightDoc.id ?? "").localeCompare(leftDoc.id ?? "");
      })
      .slice(0, limit);
  }

  private async fetchDocsPage<T>(collection: string, requestedLimit: number, cursorValue?: string) {
    const limit = Math.min(Math.max(1, Math.trunc(requestedLimit)), 100);
    const cursor = decodeCollectionCursor(cursorValue);

    if (config.useSupabase) {
      let query = this.supabase!
        .from("vectis_collections")
        .select("id,created_at,data")
        .eq("collection_name", collection)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (cursor) {
        query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
      }
      const { data, error } = await query;
      if (error) {
        log.error("Error fetching document page", { collection, error: String(error) });
        throw error;
      }
      const rows = data ?? [];
      const visibleRows = rows.slice(0, limit);
      const last = visibleRows.at(-1);
      return {
        docs: visibleRows.map((row) => row.data as T),
        nextCursor: rows.length > limit && last
          ? encodeCollectionCursor({ createdAt: String(last.created_at), id: String(last.id) })
          : undefined
      };
    }

    const docs = (await this.fetchAllDocs<T>(collection)).sort((left, right) => {
      const leftDoc = left as { createdAt?: string; id?: string };
      const rightDoc = right as { createdAt?: string; id?: string };
      return (rightDoc.createdAt ?? "").localeCompare(leftDoc.createdAt ?? "") ||
        (rightDoc.id ?? "").localeCompare(leftDoc.id ?? "");
    });
    const start = cursor
      ? docs.findIndex((doc) => {
          const item = doc as { createdAt?: string; id?: string };
          return item.createdAt === cursor.createdAt && item.id === cursor.id;
        }) + 1
      : 0;
    const safeStart = Math.max(0, start);
    const visibleDocs = docs.slice(safeStart, safeStart + limit);
    const last = visibleDocs.at(-1) as ({ createdAt?: string; id?: string } | undefined);
    return {
      docs: visibleDocs,
      nextCursor: safeStart + limit < docs.length && last?.createdAt && last.id
        ? encodeCollectionCursor({ createdAt: last.createdAt, id: last.id })
        : undefined
    };
  }

  private async queryDocsIn<T>(collection: string, field: string, values: string[], maxRows = 5000): Promise<T[]> {
    const uniqueValues = [...new Set(values.filter(Boolean))];
    if (uniqueValues.length === 0) return [];
    const queryField = jsonField(collection, field);
    if (config.useSupabase) {
      const rows: T[] = [];
      for (let from = 0; from < maxRows; from += SUPABASE_COLLECTION_PAGE_SIZE) {
        const to = Math.min(from + SUPABASE_COLLECTION_PAGE_SIZE - 1, maxRows - 1);
        const { data, error } = await this.supabase!
          .from("vectis_collections")
          .select("data")
          .eq("collection_name", collection)
          .in(queryField, uniqueValues)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          log.error("Error querying related documents", { collection, field, error: String(error) });
          return [];
        }
        const page = data ?? [];
        rows.push(...page.map((row) => row.data as T));
        if (page.length < SUPABASE_COLLECTION_PAGE_SIZE) break;
      }
      return rows;
    }

    const wanted = new Set(uniqueValues);
    return (await this.fetchAllDocs<T>(collection))
      .filter((doc) => wanted.has(String((doc as Record<string, unknown>)[field] ?? "")))
      .slice(0, maxRows);
  }

  private async fetchDocsByIds<T>(collection: string, ids: string[]): Promise<T[]> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", collection)
        .in("id", uniqueIds);
      if (error) {
        log.error("Error fetching documents by id", { collection, error: String(error) });
        return [];
      }
      return (data ?? []).map((row) => row.data as T);
    }
    const wanted = new Set(uniqueIds);
    return (await this.fetchAllDocs<T>(collection))
      .filter((doc) => wanted.has(String((doc as { id?: string }).id ?? "")));
  }

  async fetchSupabaseRegisteredUsers(): Promise<SupabaseRegisteredUser[]> {
    if (!config.useSupabase || !this.supabase) return [];

    const users: SupabaseAuthUser[] = [];
    const perPage = 1000;
    for (let page = 1; ; page += 1) {
      const { data, error } = await this.supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        log.warn("Could not fetch Supabase Auth users for admin reconciliation", { error: String(error) });
        return [];
      }
      const pageUsers = data.users ?? [];
      users.push(...pageUsers);
      if (pageUsers.length < perPage) break;
    }

    return users.map((user) => {
      const metadata = user.user_metadata ?? {};
      const fullName = typeof metadata.full_name === "string" ? metadata.full_name : undefined;
      const name = typeof metadata.name === "string" ? metadata.name : undefined;
      const avatarUrl = typeof metadata.avatar_url === "string" ? metadata.avatar_url : undefined;
      return {
        supabaseUserId: user.id,
        email: user.email ?? undefined,
        name: fullName ?? name ?? user.email ?? `Supabase user ${user.id.slice(0, 8)}`,
        avatarUrl,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? undefined
      };
    });
  }

  async countDocs(collection: string): Promise<number> {
    if (config.useSupabase) {
      const { count, error } = await this.supabase!
        .from("vectis_collections")
        .select("*", { count: "exact", head: true })
        .eq("collection_name", collection);
      if (error) {
        log.error("Error counting documents", { collection, error: String(error) });
        return 0;
      }
      return count ?? 0;
    }
    if (this.persistToDisk) {
      try {
        const files = readdirSync(this.dataDir);
        return files.filter((file) => file.startsWith(`${collection}_`)).length;
      } catch { return 0; }
    }
    return 0;
  }

  // --- Users ---

  async fetchUser(id: string) {
    return this.getDoc<User>("users", id);
  }

  async findUserByRobloxId(robloxUserId: string) {
    const results = await this.queryDocs<User>("users", "robloxUserId", robloxUserId);
    return results[0];
  }

  async findUserByGoogleId(googleUserId: string) {
    const results = await this.queryDocs<User>("users", "googleUserId", googleUserId);
    if (results[0]) return results[0];

    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "users")
        .contains("data", { googleUserIds: [googleUserId] })
        .maybeSingle();
      if (!error && data) return data.data as User;
    }

    return undefined;
  }

  async findUserByPrivateProvider() {
    const results = await this.queryDocs<User>("users", "authProvider", "private");
    return results[0];
  }

  async saveUser(user: User) {
    await this.saveDoc("users", user);
    return user;
  }

  async updateUserPreferences(userId: string, patch: NonNullable<User["preferences"]>) {
    const user = await this.fetchUser(userId);
    if (!user) return undefined;
    user.preferences = { ...(user.preferences ?? {}), ...patch };
    await this.saveUser(user);
    return user.preferences;
  }

  // --- Organizations ---

  async fetchOrganization(id: string) {
    const org = await this.getDoc<Organization>("organizations", id);
    if (org) org.plan = normalizePlanName(org.plan);
    return org;
  }

  async saveOrganization(org: Organization) {
    org.plan = normalizePlanName(org.plan);
    await this.saveDoc("organizations", org);
    return org;
  }

  async findOrganizationByStripeCustomer(stripeCustomerId: string) {
    const results = await this.queryDocs<Organization>("organizations", "stripeCustomerId", stripeCustomerId);
    return results[0];
  }

  async findOrganizationByStripeSubscription(stripeSubscriptionId: string) {
    const results = await this.queryDocs<Organization>("organizations", "stripeSubscriptionId", stripeSubscriptionId);
    return results[0];
  }

  // --- Members ---

  async fetchOrganizationForUser(userId: string) {
    const memberships = await this.queryDocs<ProjectMember>("members", "userId", userId);
    if (memberships.length === 0) return undefined;
    return this.fetchOrganization(memberships[0].organizationId);
  }

  async fetchMembersForOrganization(orgId: string) {
    return this.queryDocs<ProjectMember>("members", "organizationId", orgId);
  }

  async saveMember(member: ProjectMember) {
    await this.saveDoc("members", member);
  }

  // --- Projects ---

  async fetchProject(id: string) {
    return this.getDoc<Project>("projects", id);
  }

  async fetchProjectsForOrganization(orgId: string) {
    return this.queryDocs<Project>("projects", "organizationId", orgId);
  }

  async saveProject(project: Project) {
    project.updatedAt = now();
    await this.saveDoc("projects", project);
    return project;
  }

  async deleteProject(projectId: string) {
    const [threads, snapshots, taskRuns, attachments] = await Promise.all([
      this.fetchThreadsForProject(projectId),
      this.queryDocs<ProjectSnapshot>("snapshots", "projectId", projectId),
      this.fetchStudioTaskRunsForProject(projectId),
      this.fetchAttachmentsForProject(projectId)
    ]);

    await Promise.all([
      ...threads.map(t => this.deleteThread(t.id)),
      ...snapshots.map(s => this.deleteDoc("snapshots", s.id)),
      ...taskRuns.map(tr => this.deleteStudioTaskRun(tr.id)),
      ...attachments.map(a => this.deleteAttachment(a.id)),
      this.deleteDoc("projects", projectId)
    ]);
  }

  // --- Studio Sessions ---

  async fetchStudioSession(id: string) {
    return this.getDoc<StudioSession>("sessions", id);
  }

  async saveStudioSession(session: StudioSession) {
    await this.saveDoc("sessions", session);
    return session;
  }

  async findStudioSessionByPairingCode(code: string) {
    const normalized = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (normalized.length !== 12) return undefined;
    const formatted = `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
    const candidates = await this.queryDocs<StudioSession>("sessions", "status", "waiting");
    return candidates.find((session) => {
      const sessionCode = session.pairingCode?.replace(/[^a-z0-9]/gi, "").toUpperCase();
      return (sessionCode === normalized || session.pairingCode === formatted) && (!session.expiresAt || session.expiresAt > now());
    });
  }

  async fetchSessionsForUser(userId: string) {
    const sessions = await this.queryDocs<StudioSession>("sessions", "userId", userId);
    return sessions.sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt));
  }

  async fetchSessionsForProject(projectId: string) {
    const sessions = await this.queryDocs<StudioSession>("sessions", "projectId", projectId);
    return sessions.sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt));
  }

  // --- Auth Sessions (Web) ---

  async fetchAuthSession(id: string) {
    return this.getDoc<AuthSession>("authSessions", id);
  }

  async saveAuthSession(session: AuthSession) {
    await this.saveDoc("authSessions", session);
    return session;
  }

  async deleteAuthSession(id: string) {
    await this.deleteDoc("authSessions", id);
  }

  // --- Threads & Messages ---

  async fetchThread(id: string) {
    return this.getDoc<Thread>("threads", id);
  }

  async fetchThreadsForProject(projectId: string) {
    return this.queryDocs<Thread>("threads", "projectId", projectId);
  }

  async saveThread(thread: Thread) {
    await this.saveDoc("threads", thread);
    return thread;
  }

  async deleteThread(id: string) {
    const [msgs, changeSets, attachments] = await Promise.all([
      this.fetchMessagesForThread(id),
      this.queryDocs<ChangeSet>("changeSets", "threadId", id),
      this.fetchAttachmentsForThread(id)
    ]);

    const applyResultIds: string[] = [];
    if (changeSets.length > 0) {
      const applyResults = await this.queryDocsIn<{ id: string }>("applyResults", "changeSetId", changeSets.map((cs) => cs.id));
      applyResultIds.push(...applyResults.map((r) => r.id));
    }

    await Promise.all([
      ...msgs.map(m => this.deleteDoc("messages", m.id)),
      ...applyResultIds.map(id => this.deleteDoc("applyResults", id)),
      ...changeSets.map(cs => this.deleteDoc("changeSets", cs.id)),
      ...attachments.filter(a => a.source !== "generated_icon").map(a => this.deleteAttachment(a.id)),
      this.deleteDoc("threads", id)
    ]);
  }

  async fetchMessagesForThread(threadId: string) {
    const msgs = await this.queryDocs<AiMessage>("messages", "threadId", threadId);
    return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async fetchMessagesForProject(projectId: string) {
    return this.queryDocs<AiMessage>("messages", "projectId", projectId);
  }

  async fetchMessage(id: string) {
    return this.getDoc<AiMessage>("messages", id);
  }

  async saveMessage(msg: AiMessage) {
    await this.saveDoc("messages", msg);
    return msg;
  }

  async deleteMessage(id: string) {
    await this.deleteDoc("messages", id);
  }

  // --- ChangeSets ---

  async fetchChangeSet(id: string) {
    return this.getDoc<ChangeSet>("changeSets", id);
  }

  async fetchChangeSetsForProject(projectId: string) {
    return this.queryDocs<ChangeSet>("changeSets", "projectId", projectId);
  }

  async saveChangeSet(cs: ChangeSet) {
    await this.saveDoc("changeSets", cs);
    return cs;
  }

  async deleteChangeSet(id: string) {
    const applyResults = await this.fetchApplyResultsForChangeSet(id);
    for (const result of applyResults) await this.deleteDoc("applyResults", result.id);
    const taskRuns = await this.queryDocs<StudioTaskRun>("studioTaskRuns", "changeSetId", id);
    for (const taskRun of taskRuns) await this.deleteStudioTaskRun(taskRun.id);
    await this.deleteDoc("changeSets", id);
  }

  // --- Attachments ---

  async saveAttachment(attachment: Attachment) {
    await this.saveDoc("attachments", attachment);
    return attachment;
  }

  async fetchAttachment(id: string) {
    return this.getDoc<Attachment>("attachments", id);
  }

  async fetchAttachmentsForProject(projectId: string) {
    const attachments = await this.queryDocs<Attachment>("attachments", "projectId", projectId);
    return attachments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async fetchAttachmentsForThread(threadId: string) {
    const attachments = await this.queryDocs<Attachment>("attachments", "threadId", threadId);
    return attachments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteAttachment(id: string) {
    const attachment = await this.fetchAttachment(id);
    if (attachment) {
      await deleteAttachmentBytes(attachment).catch((err) => log.warn("Could not delete attachment bytes", { id, error: String(err) }));
    }
    await this.deleteDoc("attachments", id);
  }

  // --- Task Plans ---

  async saveTaskPlan(plan: TaskPlan) {
    await this.saveDoc("taskPlans", plan);
    return plan;
  }

  async saveAgentRun(run: AgentRun) {
    await this.saveDoc("agentRuns", run);
    return run;
  }

  async fetchAgentRun(id: string) {
    return this.getDoc<AgentRun>("agentRuns", id);
  }

  async fetchAgentRunsForThread(threadId: string) {
    return (await this.queryDocs<AgentRun>("agentRuns", "threadId", threadId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveAgentArtifact(artifact: AgentArtifact) {
    await this.saveDoc("agentArtifacts", artifact);
    return artifact;
  }

  async fetchAgentArtifact(id: string) {
    const artifact = await this.getDoc<AgentArtifact>("agentArtifacts", id);
    if (artifact && artifact.expiresAt <= now()) {
      await this.deleteDoc("agentArtifacts", id);
      return undefined;
    }
    return artifact;
  }

  async saveDesignProfile(profile: DesignProfile) {
    await this.saveDoc("designProfiles", profile);
    return profile;
  }

  async fetchDesignProfile(projectId: string) {
    return (await this.queryDocs<DesignProfile>("designProfiles", "projectId", projectId))[0];
  }

  async fetchTaskPlan(id: string) {
    return this.getDoc<TaskPlan>("taskPlans", id);
  }

  async fetchTaskPlansForProject(projectId: string) {
    return this.queryDocs<TaskPlan>("taskPlans", "projectId", projectId);
  }

  async fetchTaskPlanForThread(threadId: string) {
    const plans = await this.queryDocs<TaskPlan>("taskPlans", "threadId", threadId);
    return plans.find(p => p.status === "approved" || p.status === "draft") || plans[0];
  }

  // --- Patch Comments ---

  async savePatchComment(comment: PatchComment) {
    await this.saveDoc("patchComments", comment);
    return comment;
  }

  async fetchPatchComment(id: string) {
    return this.getDoc<PatchComment>("patchComments", id);
  }

  async fetchPatchCommentsForChangeSet(changeSetId: string) {
    return this.queryDocs<PatchComment>("patchComments", "changeSetId", changeSetId);
  }

  async fetchPatchCommentsForProject(projectId: string) {
    return this.queryDocs<PatchComment>("patchComments", "projectId", projectId);
  }

  // --- Customer evidence ---

  async saveCustomerEvidence(event: CustomerEvidenceEvent) {
    await this.saveDoc("customerEvidence", event);
    return event;
  }

  async fetchCustomerEvidenceForUser(userId: string) {
    const targetUserOrg = await this.fetchOrganizationForUser(userId);
    const byUser = await this.queryDocs<CustomerEvidenceEvent>("customerEvidence", "userId", userId);
    const byOrg = targetUserOrg ? await this.queryDocs<CustomerEvidenceEvent>("customerEvidence", "organizationId", targetUserOrg.id) : [];
    const merged = new Map<string, CustomerEvidenceEvent>();
    for (const event of [...byUser, ...byOrg]) merged.set(event.id, event);
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async fetchRecentCustomerEvidence(limit = 100, type?: CustomerEvidenceEvent["type"]) {
    if (config.useSupabase) {
      let query = this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "customerEvidence")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (type) {
        query = query.eq(jsonField("customerEvidence", "type"), type);
      }
      const { data, error } = await query;
      if (error) {
        log.error("Error fetching recent customer evidence", { error: String(error) });
        return [];
      }
      return (data ?? []).map((row) => row.data as CustomerEvidenceEvent);
    }
    const events = await this.fetchAllDocs<CustomerEvidenceEvent>("customerEvidence");
    return events
      .filter((event) => !type || event.type === type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // --- Apply results ---

  async saveApplyResult(result: ApplyResult) {
    await this.saveDoc("applyResults", result);
    return result;
  }

  async fetchApplyResultsForChangeSet(changeSetId: string) {
    return this.queryDocs<ApplyResult>("applyResults", "changeSetId", changeSetId);
  }

  // --- Ledger ---

  async fetchLedgerForOrganization(orgId: string) {
    return this.queryDocs<CreditLedger>("ledger", "organizationId", orgId);
  }

  async saveLedger(entry: CreditLedger) {
    await this.saveDoc("ledger", entry);
    return entry;
  }

  async tryDeductCredits(organizationId: string, amount: number, reason: string) {
    if (amount <= 0) {
      return { ok: true, balance: await this.getCreditBalance(organizationId) };
    }

    if (config.useSupabase) {
      const usage = await this.getUsageStats(organizationId).catch(() => undefined);
      if (usage && usage.monthly.remaining < amount) {
        return { ok: false, balance: await this.getCreditBalance(organizationId) };
      }
      const { data, error } = await this.supabase!
        .rpc("vectis_try_deduct_credits", {
          p_organization_id: organizationId,
          p_amount: amount,
          p_reason: reason
        });
      if (error) {
        log.error("Error in tryDeductCredits", { organizationId, amount, error: String(error) });
        return { ok: false, balance: 0 };
      }
      const result = (data ?? {}) as { ok?: boolean; balance?: number };
      return {
        ok: Boolean(result.ok),
        balance: Number(result.balance ?? 0)
      };
    }

    return this.runLocalLock(`deduct:${organizationId}`, async () => {
      const balance = await this.getCreditBalance(organizationId);
      if (balance < amount) {
        return { ok: false, balance };
      }
      const usage = await this.getUsageStats(organizationId).catch(() => undefined);
      if (usage && usage.monthly.remaining < amount) {
        return { ok: false, balance };
      }
      await this.deductCredits(organizationId, amount, reason);
      return { ok: true, balance: balance - amount };
    });
  }

  // --- Logs ---

  async saveLog(studioLog: StudioLog) {
    await this.saveDoc("logs", studioLog);

    try {
      const MAX_LOGS_PER_SESSION = 100;
      if (config.useSupabase) {
        const { data, error } = await this.supabase!
          .from("vectis_collections")
          .select("id")
          .eq("collection_name", "logs")
          .eq(jsonField("logs", "studioSessionId"), studioLog.studioSessionId)
          .order("created_at", { ascending: false });
        if (!error && data && data.length > MAX_LOGS_PER_SESSION) {
          await this.deleteDocsByIds("logs", data.slice(MAX_LOGS_PER_SESSION).map((row) => row.id));
        }
      } else {
        const sessionLogs = await this.queryDocs<StudioLog>("logs", "studioSessionId", studioLog.studioSessionId);
        if (sessionLogs.length > MAX_LOGS_PER_SESSION) {
          const sorted = sessionLogs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          await this.deleteDocsByIds("logs", sorted.slice(MAX_LOGS_PER_SESSION).map((l) => l.id));
        }
      }
    } catch (err) {
      log.warn("Failed to prune old logs", { sessionId: studioLog.studioSessionId, error: String(err) });
    }

    return studioLog;
  }

  async fetchLogsForSession(sessionId: string) {
    return this.queryDocs<StudioLog>("logs", "studioSessionId", sessionId);
  }

  // --- Studio task runs and observations ---

  async fetchStudioTaskRun(id: string) {
    return this.getDoc<StudioTaskRun>("studioTaskRuns", id);
  }

  async fetchStudioTaskRunsForProject(projectId: string) {
    const runs = await this.queryDocs<StudioTaskRun>("studioTaskRuns", "projectId", projectId);
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveStudioTaskRun(taskRun: StudioTaskRun) {
    await this.saveDoc("studioTaskRuns", taskRun);
    return taskRun;
  }

  async deleteStudioTaskRun(id: string) {
    await Promise.all([
      this.deleteByField("studioObservations", "taskRunId", id),
      this.deleteDoc("studioTaskRuns", id)
    ]);
  }

  async saveStudioObservation(observation: StudioObservation) {
    await this.saveDoc("studioObservations", observation);
    return observation;
  }

  async fetchStudioObservationsForTaskRun(taskRunId: string) {
    const observations = await this.queryDocs<StudioObservation>("studioObservations", "taskRunId", taskRunId);
    return observations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async fetchStudioObservationsForProject(projectId: string) {
    const observations = await this.queryDocs<StudioObservation>("studioObservations", "projectId", projectId);
    return observations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- Snapshots ---

  async fetchLatestSnapshot(projectId: string) {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "snapshots")
        .eq(jsonField("snapshots", "projectId"), projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        log.error("Error getting latest snapshot", { projectId, error: String(error) });
        return undefined;
      }
      return data ? (data.data as ProjectSnapshot) : undefined;
    }
    const snaps = await this.queryDocs<ProjectSnapshot>("snapshots", "projectId", projectId);
    return snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async saveSnapshot(snapshot: ProjectSnapshot) {
    await this.saveDoc("snapshots", snapshot);
    await this.saveDoc("contextIndexes", buildProjectContextIndex(snapshot));
    
    // Trim old snapshots
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("id")
        .eq("collection_name", "snapshots")
        .eq(jsonField("snapshots", "projectId"), snapshot.projectId)
        .order("created_at", { ascending: false });
      if (!error && data) {
        const maxSnaps = config.retention.maxSnapshotsPerProject;
        if (data.length > maxSnaps) {
          await this.deleteDocsByIds("snapshots", data.slice(maxSnaps).map((row) => row.id));
        }
      }
      return;
    }

    const snaps = await this.queryDocs<ProjectSnapshot>("snapshots", "projectId", snapshot.projectId);
    if (snaps.length > config.retention.maxSnapshotsPerProject) {
      const sorted = snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deleteDocsByIds("snapshots", sorted.slice(config.retention.maxSnapshotsPerProject).map((s) => s.id));
    }
  }

  async fetchProjectContextIndex(snapshotId: string) {
    return (await this.queryDocs<ProjectContextIndex>("contextIndexes", "snapshotId", snapshotId))[0];
  }

  async saveSnapshotChunk(chunk: StudioSnapshotChunk) {
    await this.saveDoc("snapshotChunks", chunk);
    return chunk;
  }

  async fetchSnapshotChunks(uploadId: string, sessionId: string, projectId: string) {
    const chunks = await this.queryDocs<StudioSnapshotChunk>("snapshotChunks", "uploadId", uploadId);
    return chunks
      .filter((chunk) => chunk.sessionId === sessionId && chunk.projectId === projectId)
      .sort((a, b) => a.index - b.index);
  }

  async deleteSnapshotChunks(uploadId: string, sessionId: string, projectId: string) {
    const chunks = await this.fetchSnapshotChunks(uploadId, sessionId, projectId);
    for (const chunk of chunks) {
      await this.deleteDoc("snapshotChunks", chunk.id);
    }
  }

  async deleteExpiredSnapshotChunks() {
    const nowIso = now();
    if (config.useSupabase) {
      const { count, error } = await this.supabase!
        .from("vectis_collections")
        .delete({ count: "exact" })
        .eq("collection_name", "snapshotChunks")
        .lt(jsonField("snapshotChunks", "expiresAt"), nowIso);
      if (error) {
        log.error("Error deleting expired snapshot chunks", { error: String(error) });
        return 0;
      }
      return count ?? 0;
    }
    const chunks = await this.fetchAllDocs<StudioSnapshotChunk>("snapshotChunks");
    const expired = chunks.filter((chunk) => chunk.expiresAt < nowIso);
    for (const chunk of expired) {
      await this.deleteDoc("snapshotChunks", chunk.id);
    }
    return expired.length;
  }

  async deleteExpiredAuthSessions() {
    const nowIso = now();
    if (config.useSupabase) {
      const { count, error } = await this.supabase!
        .from("vectis_collections")
        .delete({ count: "exact" })
        .eq("collection_name", "authSessions")
        .lt(jsonField("authSessions", "expiresAt"), nowIso);
      if (error) {
        log.error("Error deleting expired auth sessions", { error: String(error) });
        return 0;
      }
      return count ?? 0;
    }
    const sessions = await this.fetchAllDocs<AuthSession>("authSessions");
    const expired = sessions.filter((session) => session.expiresAt < nowIso);
    for (const session of expired) {
      await this.deleteDoc("authSessions", session.id);
    }
    return expired.length;
  }

  async deleteStaleRateLimits() {
    const cutoff = new Date(Date.now() - config.retention.rateLimitRetentionHours * 60 * 60 * 1000).toISOString();
    if (config.useSupabase) {
      const { count, error } = await this.supabase!
        .from("vectis_collections")
        .delete({ count: "exact" })
        .eq("collection_name", "rateLimits")
        .lt("updated_at", cutoff);
      if (error) {
        log.error("Error deleting stale rate limits", { error: String(error) });
        return 0;
      }
      return count ?? 0;
    }
    const limits = await this.fetchAllDocs<{ id: string; resetAt: number }>("rateLimits");
    const cutoffMs = Date.now() - config.retention.rateLimitRetentionHours * 60 * 60 * 1000;
    const stale = limits.filter((limit) => Number(limit.resetAt ?? 0) < cutoffMs);
    for (const limit of stale) {
      await this.deleteDoc("rateLimits", limit.id);
    }
    return stale.length;
  }

  async deleteOldStudioLogs() {
    const cutoff = new Date(Date.now() - config.retention.maxStudioLogAgeDays * 24 * 60 * 60 * 1000).toISOString();
    if (config.useSupabase) {
      const { count, error } = await this.supabase!
        .from("vectis_collections")
        .delete({ count: "exact" })
        .eq("collection_name", "logs")
        .lt("created_at", cutoff);
      if (error) {
        log.error("Error deleting old Studio logs", { error: String(error) });
        return 0;
      }
      return count ?? 0;
    }
    const logs = await this.fetchAllDocs<StudioLog>("logs");
    const oldLogs = logs.filter((entry) => entry.createdAt < cutoff);
    for (const entry of oldLogs) {
      await this.deleteDoc("logs", entry.id);
    }
    return oldLogs.length;
  }

  async runMaintenanceCleanup() {
    const [expiredSnapshotChunks, expiredAuthSessions, staleRateLimits, oldStudioLogs] = await Promise.all([
      this.deleteExpiredSnapshotChunks(),
      this.deleteExpiredAuthSessions(),
      this.deleteStaleRateLimits(),
      this.deleteOldStudioLogs()
    ]);
    const result = {
      expiredSnapshotChunks,
      expiredAuthSessions,
      staleRateLimits,
      oldStudioLogs
    };
    log.info("Maintenance cleanup completed", result);
    return result;
  }

  async clearRuntimeDataForProject(projectId: string) {
    const changeSets = await this.fetchChangeSetsForProject(projectId);
    const changeSetIds = changeSets.map((changeSet) => changeSet.id);

    const taskRuns = await this.fetchStudioTaskRunsForProject(projectId);
    const taskRunIds = taskRuns.map((taskRun) => taskRun.id);

    const sessions = await this.queryDocs<StudioSession>("sessions", "projectId", projectId);
    const sessionIds = sessions.map((session) => session.id);

    const attachments = await this.fetchAttachmentsForProject(projectId);
    const nonIconAttachments = attachments.filter((attachment) => attachment.source !== "generated_icon");

    await Promise.all([
      this.deleteByField("snapshots", "projectId", projectId),
      this.deleteByField("snapshotChunks", "projectId", projectId),
      this.deleteByField("messages", "projectId", projectId),
      this.deleteByField("changeSets", "projectId", projectId),
      this.deleteByField("threads", "projectId", projectId),
      this.deleteByField("customerEvidence", "projectId", projectId)
    ]);

    await Promise.all(changeSetIds.map((changeSetId) =>
      this.deleteByField("applyResults", "changeSetId", changeSetId)
    ));

    await Promise.all(nonIconAttachments.map((attachment) =>
      this.deleteAttachment(attachment.id)
    ));

    await Promise.all(taskRunIds.flatMap((taskRunId) => [
      this.deleteByField("studioObservations", "taskRunId", taskRunId),
      this.deleteByField("studioTaskRuns", "id", taskRunId)
    ]));

    await Promise.all(sessionIds.map((sessionId) =>
      this.deleteByField("logs", "studioSessionId", sessionId)
    ));
  }

  async deleteUserAccount(userId: string) {
    log.info("Starting GDPR user account deletion", { userId });

    // 1. Fetch memberships of the user
    const memberships = await this.queryDocs<ProjectMember>("members", "userId", userId);
    log.info(`Fetched ${memberships.length} memberships for deletion`, { userId });

    for (const membership of memberships) {
      const orgId = membership.organizationId;
      const org = await this.fetchOrganization(orgId);
      if (org) {
        const orgMembers = await this.fetchMembersForOrganization(orgId);
        if (orgMembers.length <= 1) {
          // 2. Fetch and delete projects under the organization
          const projects = await this.fetchProjectsForOrganization(orgId);
          log.info(`Deleting ${projects.length} projects for organization`, { orgId, userId });
          for (const project of projects) {
            await this.deleteProject(project.id);

            // Clear any remaining project chunks/sessions
            const sessions = await this.queryDocs<StudioSession>("sessions", "projectId", project.id);
            for (const session of sessions) {
              await this.deleteByField("logs", "studioSessionId", session.id);
              await this.deleteDoc("sessions", session.id);
            }
            await this.deleteByField("snapshotChunks", "projectId", project.id);
          }

          // 3. Delete organization memberships, ledger, and organization itself
          await this.deleteByField("members", "organizationId", orgId);
          await this.deleteByField("ledger", "organizationId", orgId);
          await this.deleteDoc("organizations", orgId);
          log.info("Deleted organization and its dependencies as user was the sole member", { orgId, userId });
        } else {
          log.info("Leaving organization intact as it has other members", { orgId, userId });
        }
      }
    }

    // 4. Delete sessions matching the user directly
    const userSessions = await this.queryDocs<StudioSession>("sessions", "userId", userId);
    for (const session of userSessions) {
      await this.deleteByField("logs", "studioSessionId", session.id);
      await this.deleteDoc("sessions", session.id);
    }

    // 5. Delete auth sessions
    await this.deleteByField("authSessions", "userId", userId);

    // 6. Delete memberships matching user directly
    await this.deleteByField("members", "userId", userId);

    // 7. Delete customer evidence (except billing records for compliance/legal reasons)
    const evidence = await this.queryDocs<CustomerEvidenceEvent>("customerEvidence", "userId", userId);
    for (const entry of evidence) {
      if (entry.type !== "billing") {
        await this.deleteDoc("customerEvidence", entry.id);
      }
    }

    // 8. Delete user document itself
    await this.deleteDoc("users", userId);
    log.info("GDPR user account deletion completed", { userId });
  }

  async incrementRateLimit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const id = `rate_${key}`;

    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .rpc("vectis_increment_rate_limit", {
          p_id: id,
          p_window_ms: windowMs
        });
      if (error) {
        log.error("Error in incrementRateLimit", { id, windowMs, error: String(error) });
        throw error;
      }
      const result = (data ?? {}) as { count?: number; resetAt?: number };
      return {
        count: Number(result.count ?? 0),
        resetAt: Number(result.resetAt ?? Date.now() + windowMs)
      };
    }

    const nowMs = Date.now();
    const existing = await this.getDoc<{ id: string; count: number; resetAt: number }>("rateLimits", id);
    let count = 0;
    let resetAt = nowMs + windowMs;
    if (existing && typeof existing.resetAt === "number" && existing.resetAt > nowMs) {
      count = Number(existing.count ?? 0);
      resetAt = Number(existing.resetAt);
    }
    count += 1;
    await this.saveDoc("rateLimits", { id, count, resetAt });
    return { count, resetAt };
  }

  // --- Composite Logic (Professional Refactored Methods) ---

  async resolveAuthSessionUser(sessionId?: string) {
    if (!sessionId) return undefined;
    const session = await this.fetchAuthSession(sessionId);
    if (!session || session.expiresAt < now()) return undefined;
    const user = await this.fetchUser(session.userId);
    if (user?.status === "banned") return undefined;
    return user;
  }

  async getCreditBalance(organizationId: string) {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .rpc("vectis_get_credit_balance", { p_organization_id: organizationId });
      if (error) {
        log.error("Error getting credit balance via RPC", { organizationId, error: String(error) });
        const entries = await this.fetchLedgerForOrganization(organizationId);
        return entries.reduce((acc, entry) => acc + entry.delta, 0);
      }
      return Number(data ?? 0);
    }
    const entries = await this.fetchLedgerForOrganization(organizationId);
    return entries.reduce((acc, entry) => acc + entry.delta, 0);
  }

  async getUsageStats(organizationId: string): Promise<UsageStats> {
    const org = await this.fetchOrganization(organizationId);
    const plan = planFor(org?.plan);
    const balance = await this.getCreditBalance(organizationId);
    const entries = await this.fetchLedgerForOrganization(organizationId);
    return this.calculateUsageStats(entries, plan.creditsPerWeek, plan.creditsPerMonth, balance, org?.lastRefillAt);
  }

  private calculateUsageStats(
    entries: CreditLedger[],
    weeklyAllowance: number,
    monthlyAllowance: number,
    balance: number,
    lastRefillAt?: string
  ): UsageStats {
    const { start, end } = monthWindow();
    const monthlyEntries = entries.filter((entry) => {
      const createdAt = new Date(entry.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= start.getTime() && createdAt < end.getTime();
    });
    const usageDebits = monthlyEntries
      .filter(isUsageDebit)
      .reduce((total, entry) => total + Math.abs(entry.delta), 0);
    const usageRefunds = monthlyEntries
      .filter(isUsageRefund)
      .reduce((total, entry) => total + entry.delta, 0);
    const extraCredits = monthlyEntries
      .filter(isMonthlyExtraCredit)
      .reduce((total, entry) => total + entry.delta, 0);
    const paidExtraCredits = monthlyEntries
      .filter(isPaidExtraCredit)
      .reduce((total, entry) => total + entry.delta, 0);
    const adminGrantedCredits = monthlyEntries
      .filter(isAdminGrantCredit)
      .reduce((total, entry) => total + entry.delta, 0);
    const adminAdjustedCredits = monthlyEntries
      .filter(isAdminAdjustmentCredit)
      .reduce((total, entry) => total + entry.delta, 0);
    const monthlyUsed = Math.max(0, usageDebits - usageRefunds);
    const monthlyLimit = monthlyAllowance + extraCredits;
    const weeklyRemaining = Math.min(Math.max(balance, 0), weeklyAllowance);
    const nextRefillAt = lastRefillAt
      ? new Date(new Date(lastRefillAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    return {
      weekly: {
        allowance: weeklyAllowance,
        remaining: weeklyRemaining,
        used: Math.max(0, weeklyAllowance - weeklyRemaining),
        nextRefillAt
      },
      monthly: {
        allowance: monthlyAllowance,
        extraCredits,
        paidExtraCredits,
        adminGrantedCredits,
        adminAdjustedCredits,
        limit: monthlyLimit,
        used: monthlyUsed,
        remaining: Math.max(0, monthlyLimit - monthlyUsed),
        periodStart: start.toISOString(),
        periodEnd: end.toISOString()
      }
    };
  }

  async addCredits(organizationId: string, delta: number, reason: string) {
    const entry: CreditLedger = {
      id: `ledger_${nanoid()}`,
      organizationId,
      delta,
      reason,
      createdAt: now()
    };
    await this.saveLedger(entry);
    return entry;
  }

  async addCreditsOnce(entryId: string, organizationId: string, delta: number, reason: string) {
    return this.runLocalLock(`ledger:${entryId}`, async () => {
      const entry: CreditLedger = {
        id: entryId,
        organizationId,
        delta,
        reason,
        createdAt: now()
      };
      const inserted = await this.insertDocIfAbsent("ledger", entry);
      if (inserted) return { applied: true, entry };
      const existing = await this.getDoc<CreditLedger>("ledger", entryId);
      return { applied: false, entry: existing ?? entry };
    });
  }

  async deductCredits(organizationId: string, amount: number, reason: string) {
    return this.addCredits(organizationId, -amount, reason);
  }

  async createAuthSession(userId: string) {
    const session: AuthSession = {
      id: `auth_${nanoid(32)}`,
      userId,
      createdAt: now(),
      expiresAt: daysFromNow(30)
    };
    await this.saveAuthSession(session);
    return session;
  }

  async updateOrganizationBilling(organizationId: string, patch: Partial<Organization>) {
    const org = await this.fetchOrganization(organizationId);
    if (!org) return undefined;
    const updated = { ...org, ...patch };
    await this.saveOrganization(updated);
    return updated;
  }

  async claimStripeProcessedEvent(record: StripeProcessedEvent) {
    return this.runLocalLock(`stripe:${record.id}`, async () => {
      const inserted = await this.insertDocIfAbsent("stripeProcessedEvents", record);
      if (inserted) return true;
      const existing = await this.getDoc<StripeProcessedEvent>("stripeProcessedEvents", record.id);
      if (existing) {
        const createdAtMs = Date.parse(existing.createdAt);
        const processingIsStale = existing.status === "processing"
          && Number.isFinite(createdAtMs)
          && Date.now() - createdAtMs >= STRIPE_PROCESSING_RECLAIM_MS;
        if (processingIsStale) {
          await this.saveDoc("stripeProcessedEvents", {
            ...record,
            metadata: {
              ...(existing.metadata ?? {}),
              ...(record.metadata ?? {}),
              reclaimedFromProcessingAt: now(),
              previousClaimedAt: existing.createdAt
            }
          });
          return true;
        }
        await this.saveDoc("stripeProcessedEvents", {
          ...existing,
          status: existing.status === "processed" ? existing.status : "duplicate_ignored",
          duplicateIgnoredAt: existing.duplicateIgnoredAt ?? now()
        });
      }
      return false;
    });
  }

  async finishStripeProcessedEvent(id: string, patch: Partial<StripeProcessedEvent> = {}) {
    const existing = await this.getDoc<StripeProcessedEvent>("stripeProcessedEvents", id);
    if (!existing) return undefined;
    const updated: StripeProcessedEvent = {
      ...existing,
      ...patch,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(patch.metadata ?? {})
      },
      status: "processed",
      processedAt: patch.processedAt ?? now()
    };
    await this.saveDoc("stripeProcessedEvents", updated);
    return updated;
  }

  async fetchStripeProcessedEvents(limit = 100) {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "stripeProcessedEvents")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        log.error("Error fetching stripe processed events", { error: String(error) });
        return [];
      }
      return (data ?? []).map((row) => row.data as StripeProcessedEvent);
    }
    return (await this.fetchAllDocs<StripeProcessedEvent>("stripeProcessedEvents"))
      .sort((a, b) => (b.processedAt ?? b.duplicateIgnoredAt ?? b.createdAt).localeCompare(a.processedAt ?? a.duplicateIgnoredAt ?? a.createdAt))
      .slice(0, limit);
  }

  async mergeDuplicateEmailUsers(email?: string) {
    const normalizedEmail = email?.toLowerCase().trim();
    if (!normalizedEmail) return undefined;

    let matches: User[] = [];
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "users")
        .ilike(jsonField("users", "email"), normalizedEmail);
      if (!error && data) {
        matches = data.map((d) => d.data as User);
      }
    } else {
      matches = (await this.fetchAllDocs<User>("users"))
        .filter((user) => user.email?.toLowerCase().trim() === normalizedEmail);
    }
    matches.sort((a, b) => {
      const rankDiff = duplicateUserCanonicalRank(a) - duplicateUserCanonicalRank(b);
      if (rankDiff !== 0) return rankDiff;
      const createdDiff = a.createdAt.localeCompare(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return a.id.localeCompare(b.id);
    });

    if (matches.length <= 1) return matches[0];

    const canonical = matches[0];
    const canonicalOrg = await this.fetchOrganizationForUser(canonical.id);
    if (!canonicalOrg) return canonical;
    let strongestPlan = normalizePlanName(canonicalOrg.plan);

    const googleIds = new Set<string>();
    for (const user of matches) {
      if (user.googleUserId) googleIds.add(user.googleUserId);
      for (const id of user.googleUserIds ?? []) googleIds.add(id);
    }

    canonical.googleUserId = canonical.googleUserId ?? [...googleIds][0];
    canonical.googleUserIds = [...googleIds];
    canonical.avatarUrl = canonical.avatarUrl ?? matches.find((user) => user.avatarUrl)?.avatarUrl;
    canonical.name = canonical.name || matches.find((user) => user.name)?.name || normalizedEmail;
    await this.saveUser(canonical);

    for (const duplicate of matches) {
      if (duplicate.id === canonical.id) continue;

      const duplicateOrg = await this.fetchOrganizationForUser(duplicate.id);
      await this.saveDoc("mergeLogs", {
        id: `merge_${nanoid()}`,
        canonicalUserId: canonical.id,
        duplicateUserId: duplicate.id,
        canonicalOrganizationId: canonicalOrg.id,
        duplicateOrganizationId: duplicateOrg?.id,
        email: normalizedEmail,
        duplicate,
        duplicateOrganization: duplicateOrg,
        createdAt: now()
      });

      for (const session of await this.fetchSessionsForUser(duplicate.id)) {
        session.userId = canonical.id;
        await this.saveStudioSession(session);
      }

      for (const authSession of await this.queryDocs<AuthSession>("authSessions", "userId", duplicate.id)) {
        authSession.userId = canonical.id;
        await this.saveAuthSession(authSession);
      }

      for (const thread of await this.queryDocs<Thread>("threads", "userId", duplicate.id)) {
        thread.userId = canonical.id;
        await this.saveThread(thread);
      }

      if (duplicateOrg && duplicateOrg.id !== canonicalOrg.id) {
        const duplicatePlan = normalizePlanName(duplicateOrg.plan);
        if (planRank[duplicatePlan] > planRank[strongestPlan]) {
          strongestPlan = duplicatePlan;
        }

        for (const project of await this.fetchProjectsForOrganization(duplicateOrg.id)) {
          project.organizationId = canonicalOrg.id;
          await this.saveProject(project);
        }

        for (const entry of await this.fetchLedgerForOrganization(duplicateOrg.id)) {
          entry.organizationId = canonicalOrg.id;
          await this.saveLedger(entry);
        }

        await this.updateOrganizationBilling(canonicalOrg.id, {
          plan: strongestPlan,
          stripeCustomerId: canonicalOrg.stripeCustomerId ?? duplicateOrg.stripeCustomerId,
          stripeSubscriptionId: canonicalOrg.stripeSubscriptionId ?? duplicateOrg.stripeSubscriptionId,
          stripeSubscriptionStatus: canonicalOrg.stripeSubscriptionStatus ?? duplicateOrg.stripeSubscriptionStatus,
          stripePriceId: canonicalOrg.stripePriceId ?? duplicateOrg.stripePriceId,
          billingCycle: canonicalOrg.billingCycle ?? duplicateOrg.billingCycle,
          billingCurrentPeriodEnd: canonicalOrg.billingCurrentPeriodEnd ?? duplicateOrg.billingCurrentPeriodEnd
        });
      }

      for (const member of await this.queryDocs<ProjectMember>("members", "userId", duplicate.id)) {
        await this.deleteDoc("members", member.id);
      }

      const canonicalMembers = await this.queryDocs<ProjectMember>("members", "userId", canonical.id);
      if (!canonicalMembers.some((member) => member.organizationId === canonicalOrg.id)) {
        await this.saveMember({
          id: `member_${nanoid()}`,
          organizationId: canonicalOrg.id,
          userId: canonical.id,
          role: "owner"
        });
      }

      await this.deleteDoc("users", duplicate.id);
      if (duplicateOrg && duplicateOrg.id !== canonicalOrg.id) {
        await this.deleteDoc("organizations", duplicateOrg.id);
      }
    }

    return canonical;
  }

  async mergeAllDuplicateEmailUsers() {
    const emails = new Set(
      (await this.fetchAllDocs<User>("users"))
        .map((user) => user.email?.toLowerCase().trim())
        .filter((email): email is string => Boolean(email))
    );

    for (const email of emails) {
      await this.mergeDuplicateEmailUsers(email);
    }
  }

  async reset() {
    if (this.persistToDisk) {
      try { rmSync(this.dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.hydrated = false;
    this.hydratePromise = undefined;
    await this.ready();
  }

  async ensureProjectForUser(userId: string) {
    const org = await this.fetchOrganizationForUser(userId);
    if (!org) throw new Error("User has no organization");

    const projects = await this.fetchProjectsForOrganization(org.id);
    if (projects.length > 0) return projects[0];

    const project: Project = {
      id: `project_${nanoid(10)}`,
      organizationId: org.id,
      name: "Vectis Roblox Project",
      description: "Connected Studio project.",
      template: "obby",
      createdAt: now(),
      updatedAt: now()
    };
    await this.saveProject(project);
    return project;
  }

  async upsertRobloxUser(input: {
    robloxUserId: string;
    name: string;
    robloxUsername?: string;
    avatarUrl?: string;
  }) {
    let user = await this.findUserByRobloxId(input.robloxUserId);
    if (user) {
      user.name = input.name;
      user.robloxUsername = input.robloxUsername;
      user.avatarUrl = input.avatarUrl;
      await this.saveUser(user);
    } else {
      if (config.isProduction && !config.publicSignupsEnabled) {
        throw publicSignupClosedError();
      }
      user = {
        id: `VCTR-${nanoid()}`,
        name: input.name,
        robloxUserId: input.robloxUserId,
        robloxUsername: input.robloxUsername,
        avatarUrl: input.avatarUrl,
        authProvider: "roblox",
        createdAt: now()
      };
      const org: Organization = {
        id: `org_${nanoid()}`,
        name: `${input.name}'s Vectis Workspace`,
        plan: "free",
        createdAt: now()
      };
      const member: ProjectMember = {
        id: `member_${nanoid()}`,
        organizationId: org.id,
        userId: user.id,
        role: "owner"
      };

      await this.saveUser(user);
      await this.saveOrganization(org);
      await this.saveMember(member);
      await this.addCredits(org.id, 100, "Initial creator credits");
    }

    await this.ensureProjectForUser(user.id);
    return user;
  }

  async upsertGoogleUser(input: {
    googleUserId: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  }) {
    let user = await this.findUserByGoogleId(input.googleUserId);
    if (user) {
      user.name = input.name;
      user.email = input.email;
      user.avatarUrl = input.avatarUrl;
      await this.saveUser(user);
    } else {
      const isAdmin = input.email && config.adminEmails.includes(input.email.toLowerCase().trim());
      if (config.isProduction && !config.publicSignupsEnabled && !isAdmin) {
        throw publicSignupClosedError();
      }
      user = {
        id: `VCTR-${nanoid()}`,
        name: input.name,
        email: input.email,
        avatarUrl: input.avatarUrl,
        googleUserId: input.googleUserId,
        authProvider: "google",
        createdAt: now()
      };
      const org: Organization = {
        id: `org_${nanoid()}`,
        name: `${input.name}'s Vectis Workspace`,
        plan: isAdmin ? "studio" : "free",
        createdAt: now()
      };
      const member: ProjectMember = {
        id: `member_${nanoid()}`,
        organizationId: org.id,
        userId: user.id,
        role: "owner"
      };

      await this.saveUser(user);
      await this.saveOrganization(org);
      await this.saveMember(member);
      await this.addCredits(org.id, planFor(isAdmin ? "studio" : "free").creditsPerWeek, isAdmin ? "Admin workspace credits" : "Initial workspace credits");
    }

    await this.ensureProjectForUser(user.id);
    return (await this.mergeDuplicateEmailUsers(input.email)) ?? user;
  }

  async ensurePrivateOwner() {
    const existing = await this.findUserByPrivateProvider();
    if (existing) return existing;

    const user: User = {
      id: "user_owner",
      name: "You",
      authProvider: "private",
      createdAt: now()
    };
    const organization: Organization = {
      id: "org_owner",
      name: "Vectis Code Workspace",
      plan: "free",
      createdAt: now()
    };
    const member: ProjectMember = {
      id: "member_owner",
      organizationId: organization.id,
      userId: user.id,
      role: "owner"
    };

    await this.saveUser(user);
    await this.saveOrganization(organization);
    await this.saveMember(member);
    await this.addCredits(organization.id, 100, "Private development credits");
    return user;
  }

  async upsertFirebaseUser(input: {
    firebaseUserId: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  }) {
    let user = await this.findUserByGoogleId(input.firebaseUserId);
    if (user) {
      user.name = input.name;
      user.email = input.email;
      user.avatarUrl = input.avatarUrl;
      user.authProvider = "firebase";
      await this.saveUser(user);
    } else {
      const isAdmin = input.email && config.adminEmails.includes(input.email.toLowerCase().trim());
      if (config.isProduction && !config.publicSignupsEnabled && !isAdmin) {
        throw publicSignupClosedError();
      }
      user = {
        id: `VCTR-${nanoid()}`,
        name: input.name,
        email: input.email,
        avatarUrl: input.avatarUrl,
        googleUserId: input.firebaseUserId,
        authProvider: "firebase",
        createdAt: now()
      };
      const org: Organization = {
        id: `org_${nanoid()}`,
        name: `${input.name}'s Vectis Workspace`,
        plan: isAdmin ? "studio" : "free",
        createdAt: now()
      };
      const member: ProjectMember = {
        id: `member_${nanoid()}`,
        organizationId: org.id,
        userId: user.id,
        role: "owner"
      };

      await this.saveUser(user);
      await this.saveOrganization(org);
      await this.saveMember(member);
      await this.addCredits(org.id, planFor(isAdmin ? "studio" : "free").creditsPerWeek, isAdmin ? "Admin workspace credits" : "Initial workspace credits");
    }

    await this.ensureProjectForUser(user.id);
    return (await this.mergeDuplicateEmailUsers(input.email)) ?? user;
  }

  async findUserByEmail(email: string) {
    const results = await this.queryDocs<User>("users", "email", email);
    return results[0];
  }

  async findUserBySupabaseId(supabaseUserId: string) {
    const results = await this.queryDocs<User>("users", "supabaseUserId", supabaseUserId);
    return results[0];
  }

  async upsertSupabaseUser(input: {
    supabaseUserId: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  }) {
    let user = await this.findUserBySupabaseId(input.supabaseUserId);

    if (!user && input.email) {
      user = await this.findUserByEmail(input.email);
      if (user) {
        user.supabaseUserId = input.supabaseUserId;
        user.name = input.name;
        if (input.avatarUrl) user.avatarUrl = input.avatarUrl;
        user.authProvider = "supabase";
        await this.saveUser(user);
      }
    }

    if (user) {
      user.name = input.name;
      if (input.email) user.email = input.email;
      if (input.avatarUrl) user.avatarUrl = input.avatarUrl;
      user.authProvider = "supabase";
      await this.saveUser(user);
    } else {
      const isAdmin = input.email && config.adminEmails.includes(input.email.toLowerCase().trim());
      if (config.isProduction && !config.publicSignupsEnabled && !isAdmin) {
        throw publicSignupClosedError();
      }
      user = {
        id: `VCTR-${nanoid()}`,
        name: input.name,
        email: input.email,
        avatarUrl: input.avatarUrl,
        supabaseUserId: input.supabaseUserId,
        authProvider: "supabase",
        createdAt: now()
      };
      const org: Organization = {
        id: `org_${nanoid()}`,
        name: `${input.name}'s Vectis Workspace`,
        plan: isAdmin ? "studio" : "free",
        createdAt: now()
      };
      const member: ProjectMember = {
        id: `member_${nanoid()}`,
        organizationId: org.id,
        userId: user.id,
        role: "owner"
      };

      await this.saveUser(user);
      await this.saveOrganization(org);
      await this.saveMember(member);
      await this.addCredits(org.id, planFor(isAdmin ? "studio" : "free").creditsPerWeek, isAdmin ? "Admin workspace credits" : "Initial workspace credits");
    }

    await this.ensureProjectForUser(user.id);
    return (await this.mergeDuplicateEmailUsers(input.email)) ?? user;
  }

  async checkWeeklyRefill(organizationId: string) {
    // Serialize per-org so concurrent bootstrap/chat loads cannot double-refill.
    return this.runLocalLock(`refill:${organizationId}`, async () => {
      const org = await this.fetchOrganization(organizationId);
      if (!org) return;

      const lastRefill = org.lastRefillAt ? new Date(org.lastRefillAt).getTime() : 0;
      const weekMs = 7 * 24 * 60 * 60 * 1000;

      if (Date.now() - lastRefill > weekMs) {
        const balance = await this.getCreditBalance(org.id);
        const refillAmount = planFor(org.plan).creditsPerWeek;

        if (refillAmount > 0 && balance < refillAmount) {
          await this.addCredits(org.id, refillAmount - balance, "Weekly capacity refill");
        }
        org.lastRefillAt = now();
        await this.saveOrganization(org);
      }
    });
  }

  // --- Admin Methods ---

  async fetchUsersWithStatsPage(input: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? 50)), 100);
    const page = await this.fetchDocsPage<User>("users", limit, input.cursor);
    const userIds = page.docs.map((user) => user.id);
    const members = await this.queryDocsIn<ProjectMember>("members", "userId", userIds);
    const organizationIds = [...new Set(members.map((member) => member.organizationId))];
    const [organizations, projects, sessions, evidence, attachments, ledger, total] = await Promise.all([
      this.fetchDocsByIds<Organization>("organizations", organizationIds),
      this.queryDocsIn<Project>("projects", "organizationId", organizationIds),
      this.queryDocsIn<StudioSession>("sessions", "userId", userIds),
      this.queryDocsIn<CustomerEvidenceEvent>("customerEvidence", "userId", userIds),
      this.queryDocsIn<Attachment>("attachments", "organizationId", organizationIds),
      this.queryDocsIn<CreditLedger>("ledger", "organizationId", organizationIds),
      this.countDocs("users")
    ]);

    const orgById = new Map(organizations.map((org) => [org.id, { ...org, plan: normalizePlanName(org.plan) }]));
    const firstMemberByUser = new Map<string, ProjectMember>();
    for (const member of members) {
      if (!firstMemberByUser.has(member.userId)) firstMemberByUser.set(member.userId, member);
    }
    const projectsByOrg = new Map<string, Project[]>();
    for (const project of projects) {
      const list = projectsByOrg.get(project.organizationId) ?? [];
      list.push(project);
      projectsByOrg.set(project.organizationId, list);
    }
    const sessionsByUser = new Map<string, StudioSession[]>();
    for (const session of sessions) {
      if (!session.userId) continue;
      const list = sessionsByUser.get(session.userId) ?? [];
      list.push(session);
      sessionsByUser.set(session.userId, list);
    }
    for (const list of sessionsByUser.values()) {
      list.sort((left, right) => (right.lastSeenAt ?? right.createdAt).localeCompare(left.lastSeenAt ?? left.createdAt));
    }
    const evidenceByUser = new Map<string, CustomerEvidenceEvent[]>();
    for (const event of evidence) {
      if (!event.userId) continue;
      const list = evidenceByUser.get(event.userId) ?? [];
      list.push(event);
      evidenceByUser.set(event.userId, list);
    }
    for (const list of evidenceByUser.values()) {
      list.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
    const attachmentsByOrg = new Map<string, Attachment[]>();
    for (const attachment of attachments) {
      const list = attachmentsByOrg.get(attachment.organizationId) ?? [];
      list.push(attachment);
      attachmentsByOrg.set(attachment.organizationId, list);
    }
    const ledgerByOrg = new Map<string, CreditLedger[]>();
    for (const entry of ledger) {
      const list = ledgerByOrg.get(entry.organizationId) ?? [];
      list.push(entry);
      ledgerByOrg.set(entry.organizationId, list);
    }

    const users = page.docs.map((user) => {
      const membership = firstMemberByUser.get(user.id);
      const org = membership ? orgById.get(membership.organizationId) : undefined;
      const orgProjects = org ? projectsByOrg.get(org.id) ?? [] : [];
      const userSessions = sessionsByUser.get(user.id) ?? [];
      const userEvidence = evidenceByUser.get(user.id) ?? [];
      const orgAttachments = org ? attachmentsByOrg.get(org.id) ?? [] : [];
      const orgLedger = org ? ledgerByOrg.get(org.id) ?? [] : [];
      const plan = planFor(org?.plan);
      const credits = orgLedger.reduce((sum, entry) => sum + entry.delta, 0);
      const usage = org
        ? this.calculateUsageStats(orgLedger, plan.creditsPerWeek, plan.creditsPerMonth, credits, org.lastRefillAt)
        : undefined;
      const recentEvidence = userEvidence[0];
      return {
        ...user,
        plan: org?.plan || "free",
        credits,
        projects: orgProjects.length,
        usage,
        evidenceCount: userEvidence.length,
        usageEvents: userEvidence.filter((event) => event.type === "usage").length,
        attachmentCount: orgAttachments.length,
        generatedIconCount: orgAttachments.filter((attachment) => attachment.source === "generated_icon").length,
        organizationId: org?.id,
        stripeCustomerId: org?.stripeCustomerId,
        stripeSubscriptionId: org?.stripeSubscriptionId,
        stripeSubscriptionStatus: org?.stripeSubscriptionStatus,
        stripePriceId: org?.stripePriceId,
        billingCycle: org?.billingCycle,
        billingCurrentPeriodEnd: org?.billingCurrentPeriodEnd,
        location: recentEvidence?.country || recentEvidence?.ip || "Unknown",
        lastIp: recentEvidence?.ip,
        lastUserAgent: recentEvidence?.userAgent,
        lastSeen: userSessions[0]?.lastSeenAt || user.createdAt,
        registrationSource: "vectis_app" as const,
        authOnly: false
      };
    });

    return { users, total, nextCursor: page.nextCursor };
  }

  async fetchAllUsersWithStats() {
    if (config.isProduction) {
      throw new Error("fetchAllUsersWithStats is not safe in production - use fetchUsersWithStatsPage instead");
    }
    const [
      users,
      members,
      organizations,
      projects,
      sessions,
      evidence,
      attachments,
      ledger
    ] = await Promise.all([
      this.fetchAllDocs<User>("users"),
      this.fetchAllDocs<ProjectMember>("members"),
      this.fetchAllDocs<Organization>("organizations"),
      this.fetchAllDocs<Project>("projects"),
      this.fetchAllDocs<StudioSession>("sessions"),
      this.fetchAllDocs<CustomerEvidenceEvent>("customerEvidence"),
      this.fetchAllDocs<Attachment>("attachments"),
      this.fetchAllDocs<CreditLedger>("ledger")
    ]);

    const orgById = new Map(organizations.map((org) => [org.id, { ...org, plan: normalizePlanName(org.plan) }]));
    const firstMemberByUser = new Map<string, ProjectMember>();
    for (const member of members) {
      if (!firstMemberByUser.has(member.userId)) firstMemberByUser.set(member.userId, member);
    }
    const projectsByOrg = new Map<string, Project[]>();
    for (const project of projects) {
      const list = projectsByOrg.get(project.organizationId) ?? [];
      list.push(project);
      projectsByOrg.set(project.organizationId, list);
    }
    const sessionsByUser = new Map<string, StudioSession[]>();
    for (const session of sessions) {
      if (!session.userId) continue;
      const list = sessionsByUser.get(session.userId) ?? [];
      list.push(session);
      sessionsByUser.set(session.userId, list);
    }
    for (const list of sessionsByUser.values()) {
      list.sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt));
    }
    const evidenceByUser = new Map<string, CustomerEvidenceEvent[]>();
    for (const event of evidence) {
      if (!event.userId) continue;
      const list = evidenceByUser.get(event.userId) ?? [];
      list.push(event);
      evidenceByUser.set(event.userId, list);
    }
    for (const list of evidenceByUser.values()) {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const attachmentsByOrg = new Map<string, Attachment[]>();
    for (const attachment of attachments) {
      const list = attachmentsByOrg.get(attachment.organizationId) ?? [];
      list.push(attachment);
      attachmentsByOrg.set(attachment.organizationId, list);
    }
    const ledgerByOrg = new Map<string, CreditLedger[]>();
    for (const entry of ledger) {
      const list = ledgerByOrg.get(entry.organizationId) ?? [];
      list.push(entry);
      ledgerByOrg.set(entry.organizationId, list);
    }

    const results = users.map((u) => {
      const membership = firstMemberByUser.get(u.id);
      const org = membership ? orgById.get(membership.organizationId) : undefined;
      const orgProjects = org ? projectsByOrg.get(org.id) ?? [] : [];
      const userSessions = sessionsByUser.get(u.id) ?? [];
      const userEvidence = evidenceByUser.get(u.id) ?? [];
      const orgAttachments = org ? attachmentsByOrg.get(org.id) ?? [] : [];
      const orgLedger = org ? ledgerByOrg.get(org.id) ?? [] : [];
      const plan = planFor(org?.plan);
      const credits = orgLedger.reduce((acc, entry) => acc + entry.delta, 0);
      const usage = org
        ? this.calculateUsageStats(orgLedger, plan.creditsPerWeek, plan.creditsPerMonth, credits, org.lastRefillAt)
        : undefined;
      const recentEvidence = userEvidence[0];
      const usageEvents = userEvidence.filter((event) => event.type === "usage").length;
      const generatedIcons = orgAttachments.filter((attachment) => attachment.source === "generated_icon").length;
      return {
        ...u,
        plan: org?.plan || "free",
        credits,
        projects: orgProjects.length,
        usage,
        evidenceCount: userEvidence.length,
        usageEvents,
        attachmentCount: orgAttachments.length,
        generatedIconCount: generatedIcons,
        organizationId: org?.id,
        stripeCustomerId: org?.stripeCustomerId,
        stripeSubscriptionId: org?.stripeSubscriptionId,
        stripeSubscriptionStatus: org?.stripeSubscriptionStatus,
        stripePriceId: org?.stripePriceId,
        billingCycle: org?.billingCycle,
        billingCurrentPeriodEnd: org?.billingCurrentPeriodEnd,
        location: recentEvidence?.country || recentEvidence?.ip || "Unknown",
        lastIp: recentEvidence?.ip,
        lastUserAgent: recentEvidence?.userAgent,
        lastSeen: userSessions[0]?.lastSeenAt || u.createdAt
      };
    });

    const knownSupabaseIds = new Set(
      users
        .map((user) => user.supabaseUserId)
        .filter((id): id is string => Boolean(id))
    );
    const knownEmails = new Set(
      users
        .map((user) => user.email?.toLowerCase().trim())
        .filter((email): email is string => Boolean(email))
    );
    const authOnlyUsers = (await this.fetchSupabaseRegisteredUsers())
      .filter((authUser) => !knownSupabaseIds.has(authUser.supabaseUserId))
      .filter((authUser) => !authUser.email || !knownEmails.has(authUser.email.toLowerCase().trim()))
      .map((authUser) => ({
        id: `auth:${authUser.supabaseUserId}`,
        name: authUser.name,
        email: authUser.email,
        avatarUrl: authUser.avatarUrl,
        supabaseUserId: authUser.supabaseUserId,
        authProvider: "supabase" as const,
        status: "active" as const,
        createdAt: authUser.createdAt,
        plan: "free" as const,
        credits: 0,
        projects: 0,
        usage: undefined,
        evidenceCount: 0,
        usageEvents: 0,
        attachmentCount: 0,
        generatedIconCount: 0,
        organizationId: undefined,
        stripeCustomerId: undefined,
        stripeSubscriptionId: undefined,
        stripeSubscriptionStatus: undefined,
        stripePriceId: undefined,
        billingCycle: undefined,
        billingCurrentPeriodEnd: undefined,
        location: "Supabase Auth",
        lastIp: undefined,
        lastUserAgent: undefined,
        lastSeen: authUser.lastSignInAt ?? authUser.createdAt,
        registrationSource: "supabase_auth" as const,
        authOnly: true
      }));

    return [
      ...results.map((user) => ({
        ...user,
        registrationSource: "vectis_app" as const,
        authOnly: false
      })),
      ...authOnlyUsers
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- AI Cache Methods ---

  async saveAiCache(cache: AiCache) {
    await this.saveDoc("ai_caches", cache);
  }

  async fetchAiCache(snapshotId: string, modelId: string): Promise<AiCache | null> {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "ai_caches")
        .eq(jsonField("ai_caches", "snapshotId"), snapshotId)
        .eq(jsonField("ai_caches", "modelId"), modelId)
        .maybeSingle();
      if (!error && data) {
        const cache = data.data as AiCache;
        if (new Date(cache.expiresAt) > new Date()) {
          return cache;
        }
      }
      return null;
    }
    const caches = await this.fetchAllDocs<AiCache>("ai_caches");
    return caches.find((cache) =>
      cache.snapshotId === snapshotId &&
      cache.modelId === modelId &&
      new Date(cache.expiresAt) > new Date()
    ) ?? null;
  }

  async deleteAiCache(cacheId: string) {
    await this.deleteDoc("ai_caches", cacheId);
  }

  // --- Model Evaluations ---

  async fetchEvaluationRuns(): Promise<ModelEvaluationRun[]> {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "evaluations")
        .order("created_at", { ascending: false });
      if (error) {
        log.error("Error fetching evaluations", { error: String(error) });
        return [];
      }
      return (data ?? []).map((row) => row.data as ModelEvaluationRun);
    }
    const results = await this.fetchAllDocs<ModelEvaluationRun>("evaluations");
    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async saveEvaluationRun(run: ModelEvaluationRun): Promise<ModelEvaluationRun> {
    await this.saveDoc("evaluations", run);
    return run;
  }

  async deleteEvaluationRun(runId: string) {
    await this.deleteDoc("evaluations", runId);
  }

  async clearEvaluationRuns() {
    const runs = await this.fetchEvaluationRuns();
    for (const run of runs) {
      await this.deleteDoc("evaluations", run.id);
    }
    return runs.length;
  }

  // --- Email Subscribers ---

  async saveEmailSubscriber(subscriber: { id: string; email: string; subscribedAt: string; ip?: string }) {
    await this.saveDoc("emailSubscribers", subscriber);
  }

  async fetchEmailSubscribers(): Promise<Array<{ id: string; email: string; subscribedAt: string; ip?: string }>> {
    if (config.useSupabase) {
      const { data, error } = await this.supabase!
        .from("vectis_collections")
        .select("data")
        .eq("collection_name", "emailSubscribers")
        .order("created_at", { ascending: false });
      if (error) {
        log.error("Error fetching email subscribers", { error: String(error) });
        return [];
      }
      return (data ?? []).map((row) => row.data as { id: string; email: string; subscribedAt: string; ip?: string });
    }
    const results = await this.fetchAllDocs<{ id: string; email: string; subscribedAt: string; ip?: string }>("emailSubscribers");
    return results.sort((a, b) => b.subscribedAt.localeCompare(a.subscribedAt));
  }

  async emailSubscriberExists(email: string): Promise<boolean> {
    const subscribers = await this.fetchEmailSubscribers();
    return subscribers.some((s) => s.email.toLowerCase() === email.toLowerCase());
  }

  async deleteEmailSubscriber(id: string) {
    await this.deleteDoc("emailSubscribers", id);
  }
}

export const store = new PersistentStore();
