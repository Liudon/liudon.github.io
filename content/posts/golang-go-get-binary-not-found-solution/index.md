---
title: "解决Golang使用go get安装包后找不到可执行文件的问题"
date: 2023-08-17T09:20:50+08:00
lastmod: 2026-09-09T00:00:00+08:00
draft: false
description: "解决升级 Go 后使用 go get 安装 protoc-gen-go，却提示 program not found or is not executable 的问题。"
tags: ["golang"]
---

## 问题现象

编译流水线代码

```
go get google.golang.org/protobuf/cmd/protoc-gen-go@latest

protoc -I=./zzz --proto_path=./xx --go_out=./abc --go_opt=paths=xx.proto

...

go build -o xxx
```

在 Go 升级到 1.20.1 后，执行时报错：

```
protoc-gen-go: program not found or is not executable
```

## 原因

> Starting in Go 1.17, installing executables with go get is deprecated. go install may be used instead.
>
> In a future Go release, go get will no longer build packages; it will only be used to add, update, or remove dependencies in go.mod. Specifically, go get will act as if the -d flag were enabled.
>
> [Deprecation of 'go get' for installing executables](https://go.dev/doc/go-get-install-deprecation)

从 Go 1.17 开始，官方弃用使用 `go get` 安装可执行文件；从 Go 1.18 开始，`go get` 只用于调整当前模块的依赖，不再构建和安装命令。

因此，原来的命令虽然处理了模块依赖，却没有把 `protoc-gen-go` 可执行文件安装到命令搜索路径。

## 解决方法

将安装命令替换为：

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
```

安装后可以检查可执行文件目录：

```bash
go env GOBIN
go env GOPATH
```

如果 `GOBIN` 为空，可执行文件默认安装在 `$(go env GOPATH)/bin`。流水线需要把这个目录加入 `PATH`：

```bash
export PATH="$(go env GOPATH)/bin:$PATH"
protoc-gen-go --version
```

之后再执行 `protoc --go_out=...` 即可。
