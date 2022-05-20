---
title: "一次惊心动魄的Mysql更新操作"
date: 2020-05-19T17:16:53+08:00
tags: ["mysql"]
---

#### 问题描述

```
# 表结构
MySQL > desc user_packages;
+----------------+---------------------+------+-----+---------------------+----------------+
| Field          | Type                | Null | Key | Default             | Extra          |
+----------------+---------------------+------+-----+---------------------+----------------+
| up_id          | bigint(20) unsigned | NO   | PRI | NULL                | auto_increment |
| start_date     | date                | NO   |     | NULL                |                |
| end_date       | date                | NO   |     | NULL                |                |
| up_created     | datetime            | NO   | MUL | 0000-00-00 00:00:00 |                |
| up_updated     | datetime            | NO   |     | 0000-00-00 00:00:00 |                |
+----------------+---------------------+------+-----+---------------------+----------------+
5 rows in set (0.00 sec)

MySQL > select * from user_packages limit 5;
+-------+------------+------------+
| up_id | start_date | end_date   |
+-------+------------+------------+
|   185 | 2018-04-01 | 2018-06-30 |
|   186 | 2018-04-01 | 2018-06-30 |
|   187 | 2018-04-01 | 2018-06-30 |
|   188 | 2018-04-01 | 2018-06-30 |
|   189 | 2018-04-01 | 2018-06-30 |
+-------+------------+------------+
5 rows in set (0.00 sec)
```

#### 操作过程

需要更新某条记录的`end_date`字段，执行sql如下：

```
MySQL > update user_packages set end_date = '2020-06-06' and up_id = 189 limit 1;
Query OK, 1 row affected, 1 warning (0.00 sec)
Rows matched: 1  Changed: 1  Warnings: 1
```

执行完，发现sql写错了！！！！

正确的sql应该是：

```
update user_packages set end_date = '2020-06-06' where up_id = 189 limit 1;
```

误把`where`写成了`and`，还好指定了`limit = 1`，只操作了一条记录。

#### 回滚

回滚的前提，要先找到更新的那条记录。

`up_id`为表的主键，更新前表里已经有这条记录了，主键不能重复，感觉语句应该没有执行成功。

```
MySQL > select * from user_packages where up_id = 189;
+-------+------------+------------+
| up_id | start_date | end_date   |
+-------+------------+------------+
|   189 | 2018-04-01 | 2018-06-30 |
+-------+------------+------------+
1 rows in set (0.00 sec)
```

执行查询语句，表里确实也只有这一条`up_id=189`的记录。

感觉这个`update`语句应该没执行成功，但是没执行成功应该报错的呀。

这个时候把希望放到了语句结果里的`Warnings: 1`，是不是没执行成功呢。

因为紧接着又执行了其他语句，所以也无法通过`show warnings`查看具体的错误信息了。

那么这条语句到底执行成功了吗？如果执行成功，那么修改的是哪条记录呢？

这里通过一番查找，终于定位到了记录。

`AND`分隔符，在mysql语句里优先级最高。

```
update user_packages set end_date = '2020-06-06' and up_id = 189 limit 1;

等效为

update user_packages set end_date = ('2020-06-06' and up_id = 189) limit 1;

即

update user_packages set end_date = 0 limit 1;
```

因为`end_date`字段为`date`类型，所以写入表后的记录为`0000-00-00`。

```
MySQL > select * from user_packages where end_date = '0000-00-00';
+-------+------------+------------+
| up_id | start_date | end_date   |
+-------+------------+------------+
|   185 | 2018-04-01 | 0000-00-00 |
+-------+------------+------------+
1 rows in set (0.00 sec)
```

好在这次只更新了一条记录，否则后果无法想象。

切记不要在现网直接操作DB。

__相关资料：__

[一个我认为是bug的UPDATE语句](https://wing324.github.io/2016/08/25/%E4%B8%80%E4%B8%AA%E6%88%91%E8%AE%A4%E4%B8%BA%E6%98%AFbug%E7%9A%84UPDATE%E8%AF%AD%E5%8F%A5/)