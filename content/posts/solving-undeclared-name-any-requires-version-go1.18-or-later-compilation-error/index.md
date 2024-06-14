---
title: "解决 \"undeclared name: any (requires version go1.18 or later)\" 编译错误"
date: 2024-06-14T20:41:20+08:00
draft: false
tags: ["go","protoc"]
---

```
$ go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
$ 
$ protoc-gen-go --version
protoc-gen-go v1.34.2
$ 
$ sh make.sh
user.pb.go:123:45: undeclared name: any (requires version go1.18 or later)
$ 
```

流水线编译报错，其中`make.sh`文件代码：

```
...

protoc -I=./ --proto_path=./ --go_out=./ --go_opt=paths=source_relative user.proto 

...

go build
```

同样的代码在本机编译就没问题，但是放到流水线里编译就报上面的错误。

登到流水线编译机器上，看了下`go`的版本已经是`1.18.1`了，按理不应该报这个错误的。

关键之前流水线编译是没问题的，怀疑是开发分支代码的问题，用`master`分支编译了一下，也还是报这个错误。

手动执行`make.sh`里的每条命令，发现是`protoc`编译pb文件时报的这个错误。

经过一番查找后，发现是`protoc-gen-go`在4月份更新了版本，引入了新特性。

[protoc-gen-go's versions](https://pkg.go.dev/google.golang.org/protobuf@v1.34.2/cmd/protoc-gen-go?tab=versions)

```
Versions in this module
v1
    v1.34.2 Jun 11, 2024
    v1.34.1 May 6, 2024
    v1.34.0 Apr 30, 2024
    v1.33.0 Mar 5, 2024
    v1.32.0 Dec 22, 2023
```

[Protobuf Editions Overview](https://protobuf.dev/editions/overview/)

> Protobuf Editions replace the proto2 and proto3 designations that we have used for Protocol Buffers. Instead of adding syntax = "proto2" or syntax = "proto3" at the top of proto definition files, you use an edition number, such as edition = "2024", to specify the default behaviors your file will have. Editions enable the language to evolve incrementally over time.
> 
> Instead of the hardcoded behaviors that older versions have had, editions represent a collection of features with a default value (behavior) per feature. Features are options on a file, message, field, enum, and so on, that specify the behavior of protoc, the code generators, and protobuf runtimes. You can explicitly override a behavior at those different levels (file, message, field, …) when your needs don’t match the default behavior for the edition you’ve selected. You can also override your overrides. The section later in this topic on lexical scoping goes into more detail on that.

改用历史版本后解决。

```
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.33.0
```
