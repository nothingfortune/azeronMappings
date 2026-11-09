@echo off
rem Lets PowerShell and cmd run bin\azeron, a node script with a Unix shebang they cannot follow.
node "%~dp0azeron" %*
