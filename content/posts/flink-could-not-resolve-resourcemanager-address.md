---
title: "Flink Could Not Resolve Resourcemanager Address"
date: 2019-03-28T13:00:50+08:00
tags: ["Flink"]
---

什么是Flink。

> Apache Flink® - Stateful Computations over Data Streams

Flink安装参考(官方文档)[https://ci.apache.org/projects/flink/flink-docs-release-1.7/tutorials/local_setup.html]。

这里使用`单机模式`。

#### 问题表现

启动Flink

```
[root@VM_80_180_centos /usr/local/flink-1.7.2]# ./bin/start-cluster.sh 
Starting cluster.
Starting standalonesession daemon on host VM_80_180_centos.
Starting taskexecutor daemon on host VM_80_180_centos.
```

查看进程

```
[root@VM_80_180_centos /usr/local/flink-1.7.2]# jps
10442 StandaloneSessionClusterEntrypoint
11067 Jps
10909 TaskManagerRunner
[root@VM_80_180_centos /usr/local/flink-1.7.2]# 
```

查看日志，发现"Could not resolve ResourceManager address"的错误。

```
[root@VM_80_180_centos /usr/local/flink-1.7.2]# tail -f log/flink-root-taskexecutor-*.log

2019-03-27 19:43:23,804 INFO  org.apache.flink.runtime.taskexecutor.TaskExecutor            - Could not resolve ResourceManager address akka.tcp://flink@localhost:6123/user/resourcemanager, retrying in 10000 ms: Ask timed out on [ActorSelection[Anchor(akka.tcp://flink@localhost:6123/), Path(/user/resourcemanager)]] after [10000 ms]. Sender[null] sent message of type "akka.actor.Identify"..
2019-03-27 19:43:43,843 INFO  org.apache.flink.runtime.taskexecutor.TaskExecutor            - Could not resolve ResourceManager address akka.tcp://flink@localhost:6123/user/resourcemanager, retrying in 10000 ms: Ask timed out on [ActorSelection[Anchor(akka.tcp://flink@localhost:6123/), Path(/user/resourcemanager)]] after [10000 ms]. Sender[null] sent message of type "akka.actor.Identify"..
```

访问Flink的web页面，发现task数全为0.

![flink no task](https://wx2.sinaimg.cn/large/63c9befaly1g1igknr8lyj21ae09874j.jpg)

#### 问题原因：

![taskmanager.host](https://wx2.sinaimg.cn/large/63c9befaly1g1igoreyi9j20oz04mdg7.jpg)

Flink的taskmanager.host默认为空，会使用hostname。

```
[root@VM_80_180_centos /usr/local/flink-1.7.2]# ping VM_80_180_centos
PING VM_80_180_centos (100.125.80.180) 56(84) bytes of data.
64 bytes from VM_80_180_centos (100.125.80.180): icmp_seq=1 ttl=64 time=0.022 ms
64 bytes from VM_80_180_centos (100.125.80.180): icmp_seq=2 ttl=64 time=0.038 ms
64 bytes from VM_80_180_centos (100.125.80.180): icmp_seq=3 ttl=64 time=0.038 ms
```

Flink的jobmanager.host默认为localhost。

这里jobmanager和taskmanager绑定的ip不一样，导致出错。

#### 解决办法：

```
vim conf/flink-conf.yaml

添加下面这行配置
taskmanager.host: localhost
```

保存退出，然后重新启动Flink，这个时候在web端就可以看到有可用task了。

![flink web](https://wx1.sinaimg.cn/large/63c9befaly1g1ih665ffjj21a709374r.jpg)