@echo off
title Rubrica
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "%~dp0servidor.ps1"
