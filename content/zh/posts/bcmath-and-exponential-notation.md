---
title: "BCMath 与 科学计数"
date: 2019-08-16T19:34:34+08:00
---


代码如下
```
<?php
echo 9.99997600 + 2.4E-5;
echo "\n===\n";
echo bcadd(9.99997600, 2.4E-5, 8);
```

结果为
```
10
===
9.99997600
```

问了朋友，查了各种资料，终于在PHP手册里发现了这段话。

> Caution
> Passing values of type float to a BCMath function which expects a string as operand may not have the desired effect due to the way PHP converts float values to string, namely that the string may be in exponential notation (which is not supported by BCMath), and that the decimal separator is locale dependent (while BCMath always expects a decimal point).

**PHP的BCMath方法不支持科学计数**

解决方法：

```
echo bcadd(9.99997600, number_format(2.4E-5, 8, '.', ''), 8);
```

**PHP里浮点数相关的运算一定要使用BCMath函数！**