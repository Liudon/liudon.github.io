---
title: "解决Golang使用go get安装包后找不到可执行文件的问题"
date: 2023-08-17T09:20:50+08:00
tags: ["golang"]
---

#### 背景

编译流水线代码

```
go get google.golang.org/protobuf/cmd/protoc-gen-go@latest

protoc -I=./zzz --proto_path=./xx --go_out=./abc --go_opt=paths=xx.proto

...

go build -o xxx
```

在go升级到1.20.1版本后，执行报错。

```
protoc-gen-go: program not found or is not executable
```

#### 解决

> Starting in Go 1.17, installing executables with go get is deprecated. go install may be used instead.
>
> In a future Go release, go get will no longer build packages; it will only be used to add, update, or remove dependencies in go.mod. Specifically, go get will act as if the -d flag were enabled.
>
> https://docs.studygolang.com/doc/go-get-install-deprecation


从 Go 1.7 版本开始，go get 命令默认只会下载包，不会自动编译和安装可执行文件。

因此，如果你想要使用 go get 命令安装包并编译可执行文件，你需要使用 go install 命令。

替换为`go install`解决。