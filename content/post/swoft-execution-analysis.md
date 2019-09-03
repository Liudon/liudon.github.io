---
title: "Swoft 框架运行分析（一）"
date: 2019-08-29T17:22:28+08:00
draft: false
keywords: Swoft
---

> Swoft 是一款基于 Swoole 扩展实现的 PHP 微服务协程框架。

以前一直都是用的原生swoole框架，最近有时间研究了下衍生的Swoft框架。

刚开始看的时候，感觉自己像个原始人，完全看不懂。

官方文档没有介绍Swoft的实现，网上的一些文章跟当前版本代码已经不一致了。

自己花了一周时间，终于梳理清楚了，看完更觉得自己是个原始人了。

使用的框架组件版本为：
```
swoft-2.0.5
swoft-component-2.0.5
```

这里以Swoft启动http server为例。

```
php bin/swoft http:start
```

执行上述命令，启动http server。

这里执行的是bin/swoft文件。

```
#!/usr/bin/env php
<?php declare(strict_types=1);

// Bootstrap
require_once __DIR__ . '/bootstrap.php';

Swoole\Coroutine::set([
    'max_coroutine' => 300000,
]);

// Run application
(new \App\Application())->run();

```

这里引入`bootstrap.php`文件，引入composer自动加载文件。

```
<?php
// Composer autoload
require_once dirname(__DIR__) . '/vendor/autoload.php';
```

然后执行`Swoft\App\Application`类下的`run`方法。

```
<?php declare(strict_types=1);

namespace App;

use Swoft\SwoftApplication;
use function date_default_timezone_set;

/**
 * Class Application
 *
 * @since 2.0
 */
class Application extends SwoftApplication
{
    protected function beforeInit(): void
    {
        parent::beforeInit();

        date_default_timezone_set('Asia/Shanghai');
    }
}
```

这里继承了`Swoft\SwoftApplication`类，这里只粘贴了部分代码。

```
/**
 * Swoft application
 *
 * @since 2.0
 */
class SwoftApplication implements SwoftInterface, ApplicationInterface
{

    /**
     * Class constructor.
     *
     * @param array $config
     */
    public function __construct(array $config = [])
    {
        // Check runtime env
        SwoftHelper::checkRuntime();

        // Storage as global static property.
        Swoft::$app = $this;

        // Before init
        $this->beforeInit();

        // Init console logger
        $this->initCLogger();

        // Can setting properties by array
        if ($config) {
            ObjectHelper::init($this, $config);
        }

        // Init application
        $this->init();

        CLog::info('Project path is <info>%s</info>', $this->basePath);

        // After init
        $this->afterInit();
    }

    protected function init(): void
    {
        // Init system path aliases
        $this->findBasePath();
        $this->setSystemAlias();

        $processors = $this->processors();

        $this->processor = new ApplicationProcessor($this);
        $this->processor->addFirstProcessor(...$processors);
    }

    /**
     * Run application
     */
    public function run(): void
    {
        if (!$this->beforeRun()) {
            return;
        }

        $this->processor->handle();
    }

    /**
     * @return ProcessorInterface[]
     */
    protected function processors(): array
    {
        return [
            new EnvProcessor($this),
            new ConfigProcessor($this),
            new AnnotationProcessor($this),
            new BeanProcessor($this),
            new EventProcessor($this),
            new ConsoleProcessor($this),
        ];
    }
```

`__construct`方法里检查运行环境，初始化日志组件，然后调用了`init`方法。

`init`方法里声明了`processor`对象。

`processors`方法定义了Swoft框架的6个Processor对象。

`run`方法里直接调用`processor`对象的`handler`方法。

```
<?php

namespace Swoft\Processor;

use Swoft\Stdlib\Helper\ArrayHelper;
use function get_class;

/**
 * Application processor
 * @since 2.0
 */
class ApplicationProcessor extends Processor
{
    /**
     * @var ProcessorInterface[]
     */
    private $processors = [];

    /**
     * Handle application processors
     */
    public function handle(): bool
    {
        $disabled = $this->application->getDisabledProcessors();

        foreach ($this->processors as $processor) {
            $class = get_class($processor);

            // If is disabled, skip handle.
            if (isset($disabled[$class])) {
                continue;
            }

            $processor->handle();
        }

        return true;
    }

    /**
     * Add first processor
     *
     * @param Processor[] $processor
     * @return bool
     */
    public function addFirstProcessor(Processor ...$processor): bool
    {
        array_unshift($this->processors, ... $processor);

        return true;
    }

    /**
     * Add last processor
     *
     * @param Processor[] $processor
     *
     * @return bool
     */
    public function addLastProcessor(Processor ...$processor): bool
    {
        array_push($this->processors, ... $processor);

        return true;
    }

    /**
     * Add processors
     *
     * @param int         $index
     * @param Processor[] $processors
     *
     * @return bool
     */
    public function addProcessor(int $index, Processor  ...$processors): bool
    {
        ArrayHelper::insert($this->processors, $index, ...$processors);

        return true;
    }
}
```

`addFirstProcessor`方法把process对象赋值给`$this->processors`。

`handle`方法遍历`processors`对象，循环执行`handle`方法。

Swoft的核心逻辑都是靠上面定义的6个Processor模块实现的，接下来一个一个分析。