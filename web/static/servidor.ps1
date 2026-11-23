# PDF Studio - servidor local mínimo (solo escucha en este equipo: http://localhost:8765/)
$ErrorActionPreference = 'Stop'
$port = 8765
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = "http://localhost:$port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() }
catch {
  # Probablemente ya está en ejecución: solo abrir la aplicación
  Start-Process $url
  exit
}
Write-Host "PDF Studio en ejecucion: $url"
Write-Host "Mantenga esta ventana abierta mientras usa la aplicacion (puede minimizarla)."
Start-Process $url
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json'; '.png'='image/png'; '.ico'='image/x-icon'; '.svg'='image/svg+xml'; '.css'='text/css' }
$rootFull = [System.IO.Path]::GetFullPath($root)
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $rootFull ($path.TrimStart('/') -replace '/', '\')))
    $res = $ctx.Response
    if ($file.StartsWith($rootFull) -and (Test-Path $file -PathType Leaf) -and ($file -notlike '*.ps1') -and ($file -notlike '*.bat')) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
    $res.OutputStream.Close()
  } catch { }
}
