---
title: "一个git submodule update引发的问题"
date: 2019-09-06T15:13:51+08:00
tags: ["git"]
---

#### 背景

1月份的时候，用`hugo`搭了这套博客系统。

本机写md文件，更新到`github`，然后通过`travis-ci`自动发布。

jane主题是通过`git submodule`引入的，`.gitmodules`文件内容。

```
[submodule "themes/jane"]
	path = themes/jane
	url = https://github.com/xianmin/hugo-theme-jane.git

```

#### 问题

最近几天更新完文章后，发现首页显示出了问题。

一开始以为是主题有问题，具体描述见[首页文章不显示了](https://github.com/xianmin/hugo-theme-jane/issues/244)。

在`issue`里：
`shaform`提到使用的并不是最新的版本。
`RocFang`提到是`git submodule`使用的问题。

但是`travis-ci`每次都是通过`git submodule update --init --recursive`更新子仓库代码的，为什么会不是最新的代码呢。

#### 问题重现

接下来，我们用一个新的仓库，来模拟重现一下。

1. 克隆仓库。

    ```
    [root@VM_81_18_centos xx]# git clone git@github.com:Liudon/test.git
    Cloning into 'test'...
    [root@VM_81_18_centos test]# 
    ```

2. 添加文件。

   ```
    [root@VM_81_18_centos xx]# cd test/
    [root@VM_81_18_centos test]# echo "# test" >> README.md
    [root@VM_81_18_centos test]# git add README.md
    [root@VM_81_18_centos test]# 
    ```

3. 引用子仓库。
   
   ```
    [root@VM_81_18_centos test]# git submodule add git@github.com:xianmin/hugo-theme-jane.git theme/jane
    Cloning into 'theme/jane'...
    remote: Enumerating objects: 216, done.
    remote: Counting objects: 100% (216/216), done.
    remote: Compressing objects: 100% (128/128), done.
    remote: Total 6165 (delta 102), reused 159 (delta 65), pack-reused 5949
    Receiving objects: 100% (6165/6165), 3.05 MiB | 1.70 MiB/s, done.
    Resolving deltas: 100% (3443/3443), done.
    ```

4. 查看文件列表。
   ```
    [root@VM_81_18_centos test]# ll
    total 8
    -rw-r--r-- 1 root root    5 Sep  6 16:05 README.md
    drwxr-xr-x 7 root root 4096 Sep  6 16:08 typecho
    [root@VM_81_18_centos test]# 
    ```

5. 查看状态。

    ```
    [root@VM_81_18_centos test]# git status
    # On branch master
    #
    # Initial commit
    #
    # Changes to be committed:
    #   (use "git rm --cached <file>..." to unstage)
    #
    #	new file:   .gitmodules
    #	new file:   README.md
    #	new file:   typecho
    #
    [root@VM_81_18_centos test]# 
    ```

6. 查看修改。

    ```
    [root@VM_81_18_centos test]# git diff --cached
    diff --git a/.gitmodules b/.gitmodules
    new file mode 100644
    index 0000000..b1ddf70
    --- /dev/null
    +++ b/.gitmodules
    @@ -0,0 +1,3 @@
    +[submodule "typecho"]
    +       path = typecho
    +       url = https://github.com/Liudon/typecho
    diff --git a/README.md b/README.md
    new file mode 100644
    index 0000000..9daeafb
    --- /dev/null
    +++ b/README.md
    @@ -0,0 +1 @@
    +test
    diff --git a/typecho b/typecho
    new file mode 160000
    index 0000000..b0c4cc7
    --- /dev/null
    +++ b/typecho
    @@ -0,0 +1 @@
    +Subproject commit b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1
    [root@VM_81_18_centos test]# 
    ```

    注意最后一行`Subproject commit b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1`。

    这个`commitId`是子仓库最新提交的记录id，对应的[修改记录](https://github.com/Liudon/typecho/commit/b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1)。

7. 提交修改。

    ```
    [root@VM_81_18_centos test]# git push -u origin master
    Counting objects: 4, done.
    Compressing objects: 100% (3/3), done.
    Writing objects: 100% (4/4), 362 bytes | 0 bytes/s, done.
    Total 4 (delta 0), reused 0 (delta 0)
    To git@github.com:Liudon/test.git
    * [new branch]      master -> master
    Branch master set up to track remote branch master from origin.
    [root@VM_81_18_centos test]# 
    ```

    ![提交后Github显示](https://user-images.githubusercontent.com/5969707/64412246-9050f100-d0c1-11e9-893a-f9b0766533ad.png)

    提交后，在github上子仓库后面会多显示一个`@xxxxx`，这里就是引用的`commitId`，对应到前面`git diff`最后一行。

    点击查看[提交记录](https://github.com/Liudon/test/commit/5b11d515db8ad8d299ef1691f115590e0015c3b7)。

    ![提交记录](https://user-images.githubusercontent.com/5969707/64412419-e4f46c00-d0c1-11e9-8c2d-6fa1581529f3.png)

    本次提交的`commitId`为`5b11d515db8ad8d299ef1691f115590e0015c3b7`，子仓库typecho单独记录了引入时的`commitId`，为`b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1`，对应的[提交记录](https://github.com/Liudon/typecho/tree/b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1)。

8. 接下来克隆子仓库，进行更新提交。

    ```
    [root@VM_81_18_centos xx]# git clone git@github.com:Liudon/typecho.git
    Cloning into 'typecho'...
    remote: Enumerating objects: 1, done.
    remote: Counting objects: 100% (1/1), done.
    remote: Total 7179 (delta 0), reused 0 (delta 0), pack-reused 7178
    Receiving objects: 100% (7179/7179), 7.26 MiB | 2.02 MiB/s, done.
    Resolving deltas: 100% (4844/4844), done.
    [root@VM_81_18_centos xx]# 
    [root@VM_81_18_centos xx]# cd typecho/
    [root@VM_81_18_centos typecho]# git log -n 1
    commit b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1
    Merge: c904005 8fd7492
    Author: 祁宁 <magike.net@gmail.com>
    Date:   Tue Nov 18 13:59:52 2014 +0800

        Merge branch 'master' of https://github.com/typecho/typecho
    [root@VM_81_18_centos typecho]#
    ```

    通过`git log`，确认最新的提交commitId为`b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1`，与前面的引入的一致。

    ```
    [root@VM_81_18_centos typecho]# echo "xxx" > test
    [root@VM_81_18_centos typecho]# 
    [root@VM_81_18_centos typecho]# git add test
    [root@VM_81_18_centos typecho]# git commit -m 'test'
    [master 5dcc8f4] test
    1 file changed, 1 insertion(+)
    create mode 100644 test
    [root@VM_81_18_centos typecho]# git push
    Counting objects: 4, done.
    Compressing objects: 100% (2/2), done.
    Writing objects: 100% (3/3), 252 bytes | 0 bytes/s, done.
    Total 3 (delta 1), reused 0 (delta 0)
    remote: Resolving deltas: 100% (1/1), completed with 1 local object.
    To git@github.com:Liudon/typecho.git
    b0c4cc7..5dcc8f4  master -> master
    [root@VM_81_18_centos typecho]# 
    ```

    修改文件提交。

    ```
    [root@VM_81_18_centos typecho]# git log -n 1
    commit 5dcc8f4e91cc724ba82aba5b9e7955727b58c5c2
    Author: liudon <i.mu@qq.com>
    Date:   Fri Sep 6 16:26:47 2019 +0800

        test
    [root@VM_81_18_centos typecho]#
    ```

    最新提交的`commitId`为`5dcc8f4e91cc724ba82aba5b9e7955727b58c5c2`。

9. 重新克隆`test`库。

    ```
    [root@VM_81_18_centos yy]# git clone git@github.com:Liudon/test.git
    Cloning into 'test'...
    remote: Enumerating objects: 4, done.
    remote: Counting objects: 100% (4/4), done.
    remote: Compressing objects: 100% (3/3), done.
    remote: Total 4 (delta 0), reused 4 (delta 0), pack-reused 0
    Receiving objects: 100% (4/4), done.
    [root@VM_81_18_centos yy]# cd test/
    [root@VM_81_18_centos test]# ll
    total 8
    -rw-r--r-- 1 root root    5 Sep  6 16:31 README.md
    drwxr-xr-x 2 root root 4096 Sep  6 16:31 typecho
    [root@VM_81_18_centos test]# ll typecho/
    total 0
    [root@VM_81_18_centos test]# 
    ```

    这里可以看到`typecho`目录下是没有文件的。

    ```
    [root@VM_81_18_centos test]# git submodule update --init --recursive
    Submodule 'typecho' (https://github.com/Liudon/typecho) registered for path 'typecho'
    Cloning into 'typecho'...
    remote: Enumerating objects: 4, done.
    remote: Counting objects: 100% (4/4), done.
    remote: Compressing objects: 100% (3/3), done.
    remote: Total 7182 (delta 0), reused 2 (delta 0), pack-reused 7178
    Receiving objects: 100% (7182/7182), 7.26 MiB | 1.26 MiB/s, done.
    Resolving deltas: 100% (4844/4844), done.
    Submodule path 'typecho': checked out 'b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1'
    [root@VM_81_18_centos test]#
    ```

    更新子仓库代码，这里可以看到最终`checkout`的版本为`b0c4cc77a7f8f04661fb9f75d4ba6d4d7915b0f1`，与前面提交时的版本一致。

#### 问题分析

`git submodule add`的时候，会记录当时引入时子仓库的版本id。

`git submodule update --init --recursive`，会检出引入时的仓库版本，这就是为啥代码没有更新了。

#### 问题解决

```
[root@VM_81_18_centos yy]# git clone git@github.com:Liudon/test.git
Cloning into 'test'...
remote: Enumerating objects: 4, done.
remote: Counting objects: 100% (4/4), done.
remote: Compressing objects: 100% (3/3), done.
remote: Total 4 (delta 0), reused 4 (delta 0), pack-reused 0
Receiving objects: 100% (4/4), done.
[root@VM_81_18_centos yy]# 
[root@VM_81_18_centos yy]# 
[root@VM_81_18_centos yy]# cd test/
[root@VM_81_18_centos test]# ll
total 8
-rw-r--r-- 1 root root    5 Sep  6 16:37 README.md
drwxr-xr-x 2 root root 4096 Sep  6 16:37 typecho
[root@VM_81_18_centos test]# ll typecho/
total 0
[root@VM_81_18_centos test]# 
[root@VM_81_18_centos test]# git submodule update --init --remote --recursive
Submodule 'typecho' (https://github.com/Liudon/typecho) registered for path 'typecho'
Cloning into 'typecho'...
remote: Enumerating objects: 4, done.
remote: Counting objects: 100% (4/4), done.
remote: Compressing objects: 100% (3/3), done.
remote: Total 7182 (delta 0), reused 2 (delta 0), pack-reused 7178
Receiving objects: 100% (7182/7182), 7.26 MiB | 1.24 MiB/s, done.
Resolving deltas: 100% (4844/4844), done.
Submodule path 'typecho': checked out '5dcc8f4e91cc724ba82aba5b9e7955727b58c5c2'
[root@VM_81_18_centos test]#
```

使用`git submodule update --init --remote --recursive`命令。