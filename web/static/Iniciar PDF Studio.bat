@echo off
title PDF Studio
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "%~dp0servidor.ps1"
