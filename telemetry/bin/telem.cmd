@echo off
if defined PIVOT_PYTHON (
  "%PIVOT_PYTHON%" "%~dp0..\telem.py" %*
) else (
  python "%~dp0..\telem.py" %*
)
