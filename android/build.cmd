@echo off
rem Builds the Android app with the toolchain installed under %LOCALAPPDATA%\Android
rem (JDK 17 + Android SDK command-line tools; no Android Studio needed).
rem   build.cmd assembleDebug            -> app\build\outputs\apk\debug\app-debug.apk
rem   build.cmd testDebugUnitTest
set "JAVA_HOME=%LOCALAPPDATA%\Android\jdk17"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"
call "%~dp0gradlew.bat" %*
