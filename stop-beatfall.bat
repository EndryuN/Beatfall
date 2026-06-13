@echo off
taskkill /FI "WINDOWTITLE eq mlib-api*" /T /F
taskkill /FI "WINDOWTITLE eq mlib-worker*" /T /F
