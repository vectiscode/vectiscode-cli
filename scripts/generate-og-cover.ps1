# Generates apps/web/public/images/og-cover.png (1200x630) from the brand logo.
# Re-run any time the logo or tagline changes:
#   powershell -ExecutionPolicy Bypass -File scripts/generate-og-cover.ps1

Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root "vectiscode logo.png"
$outDir  = Join-Path $root "apps\web\public\images"
$outPath = Join-Path $outDir "og-cover.png"

if (-not (Test-Path -LiteralPath $srcPath)) {
    throw "Source logo not found at $srcPath"
}
if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$logo = [System.Drawing.Image]::FromFile($srcPath)

$W = 1200
$H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

$cream      = [System.Drawing.Color]::FromArgb(253, 246, 227)
$creamDeep  = [System.Drawing.Color]::FromArgb(244, 223, 188)
$accent     = [System.Drawing.Color]::FromArgb(201, 120, 34)
$accentSoft = [System.Drawing.Color]::FromArgb(229, 128, 96)
$textPri    = [System.Drawing.Color]::FromArgb(63, 53, 37)
$textSec    = [System.Drawing.Color]::FromArgb(108, 95, 73)

$pt0 = New-Object System.Drawing.PointF(0, 0)
$pt1 = New-Object System.Drawing.PointF([float]$W, [float]$H)
$bg  = New-Object System.Drawing.Drawing2D.LinearGradientBrush($pt0, $pt1, $cream, $creamDeep)
$g.FillRectangle($bg, 0, 0, $W, $H)

$accentBrush = New-Object System.Drawing.SolidBrush($accent)
$g.FillRectangle($accentBrush, 0, 0, 14, $H)

$logoSize = 400
$logoX    = 80
$logoY    = [int](($H - $logoSize) / 2)
$logoRect = New-Object System.Drawing.Rectangle($logoX, $logoY, $logoSize, $logoSize)
$g.DrawImage($logo, $logoRect)

$textX = 540

$fontTitle = New-Object System.Drawing.Font("Segoe UI", 88, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brushPri  = New-Object System.Drawing.SolidBrush($textPri)
$g.DrawString("vectiscode", $fontTitle, $brushPri, [float]$textX, 168.0)

$fontTag  = New-Object System.Drawing.Font("Segoe UI", 38, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString("AI-powered Roblox development", $fontTag, $brushPri, [float]$textX, 290.0)

$fontSub  = New-Object System.Drawing.Font("Segoe UI", 26, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$brushSec = New-Object System.Drawing.SolidBrush($textSec)
$g.DrawString("Generate, review, and deploy Lua to Roblox Studio.", $fontSub, $brushSec, [float]$textX, 352.0)

$fontUrl = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brushUrl = New-Object System.Drawing.SolidBrush($accent)
$g.DrawString("vectiscode.com", $fontUrl, $brushUrl, [float]$textX, 470.0)

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$logo.Dispose()
$bg.Dispose()
$accentBrush.Dispose()
$brushPri.Dispose()
$brushSec.Dispose()
$brushUrl.Dispose()
$fontTitle.Dispose()
$fontTag.Dispose()
$fontSub.Dispose()
$fontUrl.Dispose()

$info = Get-Item -LiteralPath $outPath
Write-Host ("Generated {0} ({1:N0} bytes, {2}x{3})" -f $outPath, $info.Length, $W, $H)
