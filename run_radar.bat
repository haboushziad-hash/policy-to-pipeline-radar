@echo off
setlocal
cd /d "%~dp0"
title Policy to Pipeline Radar - run notebook
echo Policy to Pipeline Radar: running radar.ipynb top to bottom
echo.

rem ---- Find conda (Anaconda or Miniconda), even if it is not on PATH ----
set "CONDA_BAT="
for %%P in ("%USERPROFILE%\anaconda3" "%USERPROFILE%\miniconda3" "%LOCALAPPDATA%\anaconda3" "%LOCALAPPDATA%\miniconda3" "C:\ProgramData\anaconda3" "C:\ProgramData\miniconda3") do (
  if not defined CONDA_BAT if exist "%%~P\condabin\conda.bat" set "CONDA_BAT=%%~P\condabin\conda.bat"
)
if not defined CONDA_BAT (
  where conda >nul 2>nul
  if not errorlevel 1 set "CONDA_BAT=conda"
)

if defined CONDA_BAT (
  echo Using conda: %CONDA_BAT%
  call "%CONDA_BAT%" env list | findstr /b /c:"radar " >nul
  if errorlevel 1 (
    echo Creating the radar environment from environment.yml. First run only, this takes a few minutes...
    call "%CONDA_BAT%" env create -f environment.yml
  )
  call "%CONDA_BAT%" activate radar
) else (
  echo Conda not found. Using Python with a local virtual environment in .venv instead.
  if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv 2>nul || py -3 -m venv .venv
  )
  call ".venv\Scripts\activate.bat"
  python -m pip install --quiet --upgrade pip
  python -m pip install --quiet pandas requests nbconvert ipykernel ipywidgets
)

rem ---- SAM.gov key: typed by you, kept only in this window, never saved ----
if not defined SAM_API_KEY (
  echo.
  set /p SAM_API_KEY=Paste your SAM.gov API key and press Enter, or press Enter to skip SAM.gov: 
)

echo.
echo Running the notebook. This takes about a minute...
python -m jupyter nbconvert --to notebook --execute radar.ipynb --inplace --allow-errors --ExecutePreprocessor.timeout=600
python -c "import json;nb=json.load(open('radar.ipynb',encoding='utf-8'));errs=[i for i,c in enumerate(nb['cells']) if c['cell_type']=='code' and any(o.get('output_type')=='error' for o in c.get('outputs',[]))];print();print('Cells with errors:', errs if errs else 'none')"

echo.
echo Outputs: radar.ipynb (with results), mockup\radar_mockup.html, mockup\ask_the_radar.html, data\processed\signals.csv
if exist "mockup\radar_mockup.html" start "" "mockup\radar_mockup.html"
echo.
pause
