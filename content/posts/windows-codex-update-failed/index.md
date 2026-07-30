---
title: "Windows 下 Codex Cli 更新报 Move-Item is denied 错误的解决"
date: 2026-07-30T10:48:09+08:00
draft: false
description: "记录 Windows 下 Codex Cli 更新报 Move-Item is denied 错误的解决过程，最终定位是杀毒软件防护的原因导致。"
summary: "记录 Windows 下 Codex Cli 更新报 Move-Item is denied 错误的解决过程，最终定位是杀毒软件防护的原因导致。"
tags:
- codex
---

最近在 VibeCoding 一个小工具，遇到了好几次 Windows下 Codex Cli 更新失败的问题，每次都要花不少时间解决。

这次特地把问题搞清楚了，做个记录。

## 问题现象

Codex Cli 有版本更新，使用 Powershell 命令进行更新。

```
powershell -NoProfile -ExecutionPolicy Bypass -Command '$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex'
```

执行最后报错。

```
==> Updating Codex CLI from 0.144.6 to 0.146.0
==> Detected platform: Windows (x64)
==> Resolved version: 0.146.0
==> Downloading Codex CLI
Move-Item : Access to the path 'C:\Users\liudon\.codex\packages\standalone\releases\.staging.0.146.0-x86_64-pc-windows-msvc.14684' is denied.
At line:1006 char:13
+             Move-Item -LiteralPath $stagingDir -Destination $releaseD ...
+             ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : WriteError: (C:\Users\liudon...dows-msvc.14684:DirectoryInfo) [Move-Item], IOException
    + FullyQualifiedErrorId : MoveDirectoryItemIOError,Microsoft.PowerShell.Commands.MoveItemCommand
```

## 问题原因

看到 denied 这个错误，首先想到的是权限问题。

但我是用的管理员启动的 Powershell 终端，理论上不应该有这个问题。

经过跟 ChatGPT 一番沟通定位，最终确认是杀毒软件的防护导致的。

我本机安装了腾讯电脑管家，关闭防护后再进行更新就ok了。

```
# 先清理遗留文件
$releases = "$env:USERPROFILE\.codex\packages\standalone\releases"
>>
>> Get-ChildItem $releases -Force -Directory -Filter ".staging.*" |
>>     Remove-Item -Recurse -Force

# 重新进行更新
powershell -NoProfile -ExecutionPolicy Bypass -Command `
>>   '$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex'
==> Updating Codex CLI from 0.144.6 to 0.146.0
==> Detected platform: Windows (x64)
==> Resolved version: 0.146.0
==> Downloading Codex CLI
==> C:\Users\liudon\AppData\Local\Programs\OpenAI\Codex\bin is already on PATH.
==> Current PowerShell session: codex
==> Future PowerShell windows: open a new PowerShell window and run: codex
Codex CLI 0.146.0 installed successfully.
```
