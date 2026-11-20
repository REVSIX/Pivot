param([Parameter(Mandatory=$true)][string]$Destination)
Add-Type -AssemblyName System.Drawing
$frames = @(foreach($size in 16,24,32,48,64,128,256) {
  $bitmap = New-Object Drawing.Bitmap $size,$size
  $canvas = [Drawing.Graphics]::FromImage($bitmap)
  $canvas.SmoothingMode = 'AntiAlias'
  $canvas.ScaleTransform($size / 64.0, $size / 64.0)
  $wire = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#dee3f2')),4
  $canvas.DrawPolygon($wire,[Drawing.Point[]]@([Drawing.Point]::new(31,10),[Drawing.Point]::new(9,51),[Drawing.Point]::new(55,51)))
  foreach($point in @(@(31,10,'#ff4b56'),@(9,51,'#191a26'),@(55,51,'#ffc84f'))) {
    $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($point[2]))
    $canvas.FillEllipse($brush,$point[0]-7,$point[1]-7,14,14)
    $canvas.DrawEllipse($wire,$point[0]-7,$point[1]-7,14,14)
    $brush.Dispose()
  }
  $stream = New-Object IO.MemoryStream
  $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  [PSCustomObject]@{Size=$size;Bytes=$stream.ToArray()}
  $stream.Dispose(); $wire.Dispose(); $canvas.Dispose(); $bitmap.Dispose()
})
$dest = [IO.BinaryWriter]::new([IO.File]::Create($Destination))
try {
  $dest.Write([UInt16]0);$dest.Write([UInt16]1);$dest.Write([UInt16]$frames.Count)
  $offset=6+16*$frames.Count
  foreach($frame in $frames) {
    $dimension=[byte]($frame.Size % 256)
    $dest.Write($dimension);$dest.Write($dimension);$dest.Write([byte]0);$dest.Write([byte]0)
    $dest.Write([UInt16]1);$dest.Write([UInt16]32);$dest.Write([UInt32]$frame.Bytes.Length);$dest.Write([UInt32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach($frame in $frames){$dest.Write([byte[]]$frame.Bytes)}
} finally {$dest.Dispose()}
