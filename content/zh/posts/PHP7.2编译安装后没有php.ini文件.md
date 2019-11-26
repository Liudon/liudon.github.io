---
title: "PHP7.2编译安装后没有php.ini文件的问题"
date: 2019-11-26T19:56:18+08:00
tag: ["php"]
---

下载PHP7.2源码，编译安装。

```
[root@VM_73_135_centos ~/swoole-src-4.4.12]# php -v
PHP 7.2.25 (cli) (built: Nov 26 2019 19:33:23) ( NTS )
Copyright (c) 1997-2018 The PHP Group
Zend Engine v3.2.0, Copyright (c) 1998-2018 Zend Technologies
[root@VM_73_135_centos ~/swoole-src-4.4.12]# 
```

安装Swoole。

```
phpize && \
./configure && \
make && make install
```

安装完，准备修改`php.ini`文件，结果没找到。

```
[root@VM_73_135_centos ~/swoole-src-4.4.12]# ll /usr/local/services/php/etc/
total 88
-rw-r--r-- 1 root root  1364 Nov 26 19:34 pear.conf
-rw-r--r-- 1 root root  4508 Nov 26 19:34 php-fpm.conf.default
drwxr-xr-x 2 root root  4096 Nov 26 19:34 php-fpm.d
```

```
[root@VM_73_135_centos ~/swoole-src-4.4.12]# php -i | grep "Loaded Confi"
Loaded Configuration File => (none)
```

这是什么鬼，居然没有`php.ini`文件。

原来PHP源码里提供了两个`php.ini`文件，你需要按需拷贝到你的PHP的目录下。

```
[root@VM_73_135_centos ~/swoole-src-4.4.12]# ll ../php-7.2.25 | grep ini
-rw-rw-r--  1 root root   71232 Nov 20 23:11 php.ini-development
-rw-rw-r--  1 root root   71413 Nov 20 23:11 php.ini-production
```

拷贝后。

```
[root@VM_73_135_centos ~/swoole-src-4.4.12]# php -i | grep "Loaded Confi"
Loaded Configuration File => /usr/local/services/php/etc/php.ini
[root@VM_73_135_centos ~/swoole-src-4.4.12]#
```