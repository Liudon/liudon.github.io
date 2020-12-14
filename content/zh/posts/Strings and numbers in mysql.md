---
title: "mysql中字符串和整型自动转换的问题"
date: 2020-12-14T18:47:29+08:00
draft: false
---

表结构如下

```
desc info;
+-------+-----------------+------+-----+---------+----------------+
| Field | Type            | Null | Key | Default | Extra          |
+-------+-----------------+------+-----+---------+----------------+
| id    | int(8) unsigned | NO   | PRI | NULL    | auto_increment |
| name  | varchar(20)     | YES  |     | NULL    |                |
+-------+-----------------+------+-----+---------+----------------+
2 rows in set (0.00 sec)
```

执行sql.

```
insert into info values ('', 'xxx');
insert into info values ('', 'yyy');
```

查询记录.

```
select * from info;
+----+------+
| id | name |
+----+------+
|  1 | xxx  |
|  2 | yyy  |
+----+------+
2 rows in set (0.00 sec)
```

执行下面sql.

```
select * from info where id = 1;

select * from info where id = '1aaaa';
```

你先想想结果会是什么。

```
select * from info where id = 1;
+----+------+
| id | name |
+----+------+
|  1 | xxx  |
+----+------+
1 row in set (0.00 sec)

select * from info where id = '1aaaa';
+----+------+
| id | name |
+----+------+
|  1 | xxx  |
+----+------+
1 row in set, 1 warning (0.01 sec)
```

两个sql都查到了id = 1的记录，唯一的区别在于第二个sql有一个warning错误。

```
show warnings;
+---------+------+-------------------------------------------+
| Level   | Code | Message                                   |
+---------+------+-------------------------------------------+
| Warning | 1292 | Truncated incorrect DOUBLE value: '1aaaa' |
+---------+------+-------------------------------------------+
1 row in set (0.00 sec)
```

mysql在查询时，会根据字段类型进行转换，这里`1aaaa`被转为了`1`。

