<#
  Enkel lokal webserver for testing (krever ingen Node/Python).
  Kjor: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5500]
  Apne deretter http://localhost:5500 i nettleseren (eller http://<PC-ens-IP>:5500 fra mobil pa samme WiFi).
#>
param(
  [int]$Port = 5500
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".ico"  = "image/x-icon"
  ".webmanifest" = "application/manifest+json"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://+:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "Kunne ikke starte pa alle nettverksgrensesnitt (krever admin). Prover kun localhost..." -ForegroundColor Yellow
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$Port/")
  $listener.Start()
}

Write-Host "Server kjorer: http://localhost:$Port  (rot: $root)" -ForegroundColor Green
Write-Host "Trykk Ctrl+C for a stoppe." -ForegroundColor DarkGray

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    try {
      $relPath = [Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relPath)) { $relPath = "index.html" }
      $filePath = Join-Path $root $relPath

      if ((Test-Path $filePath) -and -not (Get-Item $filePath).PSIsContainer) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.KeepAlive = $false
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.OutputStream.Flush()
      } else {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relPath")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
      }
    } catch {
      $response.StatusCode = 500
    } finally {
      $response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
