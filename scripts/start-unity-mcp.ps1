$uvxCandidates = @(
  (Get-Command uvx -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  "$env:APPDATA\Python\Python311\Scripts\uvx.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if ($uvxCandidates.Count -eq 0) {
  throw "uvx が見つかりません。先に `python -m pip install --user uv` を実行してください。"
}

& $uvxCandidates[0] --from mcpforunityserver mcp-for-unity --transport http --http-url http://localhost:8080
