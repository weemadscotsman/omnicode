# OmniCode system-tray indicator (Windows).
# A tiny tray icon with LIVE updates: reads ~/.omnicode/session.json (written by the
# MCP server on every tool call) and shows calls + tokens saved in the tooltip,
# with a balloon notification on milestones. No dependencies — pure .NET/PowerShell.
#
#   Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\omnicode-tray.ps1
#   (or pin a shortcut to it). Right-click the icon for stats / exit.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$sessionFile = Join-Path $env:USERPROFILE ".omnicode\session.json"
$script:lastMilestone = 0

function New-DotIcon([System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap 16,16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $color), 2,2,12,12)
  $g.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$iconActive = New-DotIcon ([System.Drawing.Color]::FromArgb(0,240,140))
$iconIdle   = New-DotIcon ([System.Drawing.Color]::FromArgb(90,110,130))

function Format-Num([double]$n) {
  if ($n -ge 1000000) { return ('{0:0.0}M' -f ($n/1000000)) }
  if ($n -ge 1000)    { return ('{0:0.0}k' -f ($n/1000)) }
  return [int]$n
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $iconIdle
$notify.Text = "OmniCode — waiting for activity"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miStats = $menu.Items.Add("Show stats")
$miOpen  = $menu.Items.Add("Open session.json")
$menu.Items.Add("-") | Out-Null
$miExit  = $menu.Items.Add("Exit")
$notify.ContextMenuStrip = $menu

function Read-Session {
  if (-not (Test-Path $sessionFile)) { return $null }
  try { return Get-Content $sessionFile -Raw | ConvertFrom-Json } catch { return $null }
}

$miStats.add_Click({
  $s = Read-Session
  if ($null -eq $s) { $notify.ShowBalloonTip(3000, "OmniCode", "No session yet. Start the MCP server and run a tool.", 'Info'); return }
  $up = [int]((Get-Date).ToUniversalTime() - (Get-Date '1970-01-01').AddMilliseconds($s.startedAt)).TotalMinutes
  $notify.ShowBalloonTip(5000, "OmniCode — active",
    ("Calls: {0}  (errors {1})`nTokens saved (est): {2}`nLast tool: {3}`nUptime: {4}m" -f $s.calls, $s.errors, (Format-Num $s.tokensSaved), $s.lastTool, $up), 'Info')
})
$miOpen.add_Click({ if (Test-Path $sessionFile) { Start-Process notepad $sessionFile } })
$miExit.add_Click({ $notify.Visible = $false; $timer.Stop(); [System.Windows.Forms.Application]::Exit() })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
  $s = Read-Session
  if ($null -eq $s) { $notify.Icon = $iconIdle; $notify.Text = "OmniCode — idle (no session)"; return }
  $notify.Icon = $iconActive
  # NotifyIcon tooltip max ~63 chars
  $notify.Text = ("OmniCode * {0} calls * ~{1} saved * {2}" -f $s.calls, (Format-Num $s.tokensSaved), $s.lastTool)
  if ($s.tokensSaved -ge ($script:lastMilestone + 50000)) {
    $script:lastMilestone = [math]::Floor($s.tokensSaved/50000)*50000
    $notify.ShowBalloonTip(4000, "OmniCode", ("~{0} tokens saved this session" -f (Format-Num $s.tokensSaved)), 'Info')
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
