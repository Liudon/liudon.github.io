---
title: "Swoft 框架运行分析（五） —— ConsoleProcessor模块分析"
date: 2019-09-26T13:14:23+08:00
tags: ["Swoft"]
---

> 这里以Swoft启动http server为例。
>
> php bin/swoft http:start
>
> 执行上述命令，启动http server。

在前面第一篇文章的时候，提到了如何启动http服务。

今天我们就来看一下http服务是如何启动的，具体实现就在`ConsoleProcess`这个模块。

```
/**
    * Handle console
    * @return bool
    * @throws ReflectionException
    * @throws ContainerException
    */
public function handle(): bool
{
    if (!$this->application->beforeConsole()) {
        return false;
    }

    /** @var Router $router */
    $router = bean('cliRouter');

    // Register console routes
    CommandRegister::register($router);

    CLog::info(
        'Console command route registered (group %d, command %d)',
        $router->groupCount(),
        $router->count()
    );

    // Run console application
    bean('cliApp')->run();

    return $this->application->afterConsole();
}
```

这里调用了`bean`方法获取`Bean`实例，定义见`swoft-component-2.0.5\src\bean\src\Helper\Functions.php`。

```
if (!function_exists('bean')) {
    /**
     * Get bean by name
     *
     * @param string $name Bean name Or alias Or class name
     *
     * @return object|string|mixed
     */
    function bean(string $name)
    {
        if (BeanFactory::isSingleton('config')) {
            return BeanFactory::getBean($name);
        }

        return sprintf('${%s}', $name);
    }
}
```

这里调用了`BeanFactory`的`getBean`方法。

```
/**
    * Get object by name
    *
    * @param string $name Bean name Or alias Or class name
    *
    * @return object|mixed
    */
public static function getBean(string $name)
{
    return Container::getInstance()->get($name);
}
```

最终调用的是`Swoft\Bean\Container`下的`get`方法。

```
/**
    * Finds an entry of the container by its identifier and returns it.
    *
    * @param string $id Bean name Or alias Or class name
    *
    * When class name will return all of instance for class name
    *
    * @return object
    * @throws InvalidArgumentException
    */
public function get($id)
{
    // It is singleton
    if (isset($this->singletonPool[$id])) {
        return $this->singletonPool[$id];
    }

    // Prototype by clone
    if (isset($this->prototypePool[$id])) {
        return clone $this->prototypePool[$id];
    }

    // Alias name
    $aliasId = $this->aliases[$id] ?? '';
    if ($aliasId) {
        return $this->get($aliasId);
    }

    // Class name
    $classNames = $this->classNames[$id] ?? [];
    if ($classNames) {
        $id = end($classNames);
        return $this->get($id);
    }

    // Interface
    if (interface_exists($id)) {
        $id = InterfaceRegister::getInterfaceInjectBean($id);
        return $this->get($id);
    }

    // Not defined
    if (!isset($this->objectDefinitions[$id])) {
        throw new InvalidArgumentException(sprintf('The bean of %s is not defined', $id));
    }

    /* @var ObjectDefinition $objectDefinition */
    $objectDefinition = $this->objectDefinitions[$id];

    // Prototype
    return $this->safeNewBean($objectDefinition->getName());
}
```

获取对应的`ObjectDefinition`实例，然后调用`safeNewBean`方法。

```
/**
    * Secure creation of beans
    *
    * @param string $beanName
    * @param string $id
    *
    * @return object|mixed
    */
private function safeNewBean(string $beanName, string $id = '')
{
    try {
        return $this->newBean($beanName, $id);
    } catch (Throwable $e) {
        throw new InvalidArgumentException($e->getMessage(), 500, $e);
    }
}
```

这里又调用了`newBean`方法，在上一篇文章里我们已经讲过这个方法，这里会返回实例化后的`Bean`类。

那`cliRouter`对应的类是说明呢？这个定义在`swoft-component-2.0.5\src\console\src\AutoLoader.php`里。

```
/**
    * {@inheritDoc}
    */
public function beans(): array
{
    return [
        'cliApp'    => [
            'class'   => Application::class,
            'version' => '2.0.0'
        ],
        'cliRouter' => [
            'class' => Router::class,
        ],
        'cliDispatcher' => [
            'class' => ConsoleDispatcher::class,
        ],
    ];
}
```

所以`$router = bean('cliRouter')`，返回的是一个`Swoft\Console\Router\Router`类。

回到`ConsoleProcessor`类，接着看代码。

```
CommandRegister::register($router);
```

调用了`CommandRegister`类的`register`方法。

```

/**
    * @param Router $router
    * @throws ReflectionException
    */
public static function register(Router $router): void
{
    $maxLen  = 12;
    $groups  = [];
    $docOpts = [
        'allow' => ['example']
    ];
    $defInfo = [
        'example'     => '',
        'description' => 'No description message',
    ];

    foreach (self::$commands as $class => $mapping) {
        $names = [];
        $group = $mapping['group'];
        // Set ID aliases
        $router->setIdAliases($mapping['idAliases']);
        // Set group name aliases
        $router->setGroupAliases($group, $mapping['aliases']);

        $refInfo = Swoft::getReflection($class);
        $mhdInfo = $refInfo['methods'] ?? [];
        $grpOpts = $mapping['options'] ?? [];

        foreach ($mapping['commands'] as $method => $route) {
            // $method = $route['method'];
            $cmdDesc = $route['desc'];
            $command = $route['command'];

            $idLen = strlen($group . $command);
            if ($idLen > $maxLen) {
                $maxLen = $idLen;
            }

            $cmdExam = '';
            if (!empty($mhdInfo[$method]['comments'])) {
                $tagInfo = DocBlock::getTags($mhdInfo[$method]['comments'], $docOpts, $defInfo);
                $cmdDesc = $cmdDesc ?: Str::firstLine($tagInfo['description']);
                $cmdExam = $tagInfo['example'];
            }

            $route['group']   = $group;
            $route['desc']    = ucfirst($cmdDesc);
            $route['example'] = $cmdExam;
            $route['options'] = self::mergeOptions($grpOpts, $route['options']);
            // Append group option
            $route['enabled']   = $mapping['enabled'];
            $route['coroutine'] = $mapping['coroutine'];

            $router->map($group, $command, [$class, $method], $route);
            $names[] = $command;
        }

        $groupExam = '';
        $groupDesc = $mapping['desc'];
        if (!empty($refInfo['comments'])) {
            $tagInfo   = DocBlock::getTags($refInfo['comments'], $docOpts, $defInfo);
            $groupDesc = $groupDesc ?: Str::firstLine($tagInfo['description']);
            $groupExam = $tagInfo['example'];
        }

        $groups[$group] = [
            'names'   => $names,
            'desc'    => ucfirst($groupDesc),
            'class'   => $class,
            'alias'   => $mapping['alias'],
            'aliases' => $mapping['aliases'],
            'example' => $groupExam,
        ];
    }

    $router->setGroups($groups);
    // +1 because router->delimiter
    $router->setKeyWidth($maxLen + 1);
    // clear data
    self::$commands = [];
}
```

这里遍历了类属性`$commands`注册路由。

那么`$commands`这个属性是哪里来的呢？

既然开头我们说的是http服务是怎么启动的，这里我们就以`http-server`来举例，找到`swoft-component-2.0.5\src\http-server\src\Command\HttpServerCommand.php`文件。

```
<?php declare(strict_types=1);

namespace Swoft\Http\Server\Command;

use ReflectionException;
use Swoft;
use Swoft\Bean\Exception\ContainerException;
use Swoft\Console\Annotation\Mapping\Command;
use Swoft\Console\Annotation\Mapping\CommandMapping;
use Swoft\Console\Annotation\Mapping\CommandOption;
use Swoft\Console\Helper\Show;
use Swoft\Http\Server\HttpServer;
use Swoft\Server\Command\BaseServerCommand;
use Swoft\Server\Exception\ServerException;
use function bean;
use function input;
use function output;

/**
 * Provide some commands to manage the swoft HTTP server
 *
 * @since 2.0
 *
 * @Command("http", alias="httpsrv", coroutine=false)
 * @example
 *  {fullCmd}:start     Start the http server
 *  {fullCmd}:stop      Stop the http server
 */
class HttpServerCommand extends BaseServerCommand
{
    /**
     * Start the http server
     *
     * @CommandMapping(usage="{fullCommand} [-d|--daemon]")
     * @CommandOption("daemon", short="d", desc="Run server on the background", type="bool", default="false")
     *
     * @throws ReflectionException
     * @throws ContainerException
     * @throws ServerException
     * @example
     *   {fullCommand}
     *   {fullCommand} -d
     *
     */
    public function start(): void
    {
        $server = $this->createServer();

        // Check if it has started
        if ($server->isRunning()) {
            $masterPid = $server->getPid();
            output()->writeln("<error>The HTTP server have been running!(PID: {$masterPid})</error>");
            return;
        }

        // Startup settings
        $this->configStartOption($server);

        $settings = $server->getSetting();
        // Setting
        $workerNum = $settings['worker_num'];

        // Server startup parameters
        $mainHost = $server->getHost();
        $mainPort = $server->getPort();
        $modeName = $server->getModeName();
        $typeName = $server->getTypeName();

        // Http
        $panel = [
            'HTTP' => [
                'listen' => $mainHost . ':' . $mainPort,
                'type'   => $typeName,
                'mode'   => $modeName,
                'worker' => $workerNum,
            ],
        ];

        // Port Listeners
        $panel = $this->appendPortsToPanel($server, $panel);

        Show::panel($panel);

        output()->writeln('<success>HTTP server start success !</success>');

        // Start the server
        $server->start();
    }

    /**
     * Reload worker processes
     *
     * @CommandMapping(usage="{fullCommand} [-t]")
     * @CommandOption("t", desc="Only to reload task processes, default to reload worker and task")
     *
     * @throws ReflectionException
     * @throws ContainerException
     */
    public function reload(): void
    {
        $server = $this->createServer();
        $script = input()->getScript();

        // Check if it has started
        if (!$server->isRunning()) {
            output()->writeln('<error>The HTTP server is not running! cannot reload</error>');
            return;
        }

        output()->writef('<info>Server %s is reloading</info>', $script);

        if ($reloadTask = input()->hasOpt('t')) {
            Show::notice('Will only reload task worker');
        }

        if (!$server->reload($reloadTask)) {
            Show::error('The swoole server worker process reload fail!');
            return;
        }

        output()->writef('<success>HTTP server %s reload success</success>', $script);
    }

    /**
     * Stop the currently running server
     *
     * @CommandMapping()
     *
     * @throws ReflectionException
     * @throws ContainerException
     */
    public function stop(): void
    {
        $server = $this->createServer();

        // Check if it has started
        if (!$server->isRunning()) {
            output()->writeln('<error>The HTTP server is not running! cannot stop.</error>');
            return;
        }

        // Do stopping.
        $server->stop();
    }

    /**
     * Restart the http server
     *
     * @CommandMapping(usage="{fullCommand} [-d|--daemon]",)
     * @CommandOption("daemon", short="d", desc="Run server on the background")
     *
     * @throws ReflectionException
     * @throws ContainerException
     * @example
     *  {fullCommand}
     *  {fullCommand} -d
     */
    public function restart(): void
    {
        $server = $this->createServer();

        // Check if it has started
        if ($server->isRunning()) {
            $success = $server->stop();

            if (!$success) {
                output()->error('Stop the old server failed!');
                return;
            }
        }

        output()->writef('<success>Server HTTP restart success !</success>');
        $server->startWithDaemonize();
    }

    /**
     * @return HttpServer
     * @throws ReflectionException
     * @throws ContainerException
     */
    private function createServer(): HttpServer
    {
        $script  = input()->getScript();
        $command = $this->getFullCommand();

        /** @var HttpServer $server */
        $server = bean('httpServer');
        $server->setScriptFile(Swoft::app()->getPath($script));
        $server->setFullCommand($command);

        return $server;
    }
}
```

通过[Swoft文档](https://www.swoft.org/docs/2.x/zh-CN/annotation/usage.html)，我们可以看到这里分别使用了类注解和方法注解。

```
@Command("http", alias="httpsrv", coroutine=false)
@CommandMapping(usage="{fullCommand} [-d|--daemon]")
@CommandOption("daemon", short="d", desc="Run server on the background", type="bool", default="false")
...
```

通过第二篇文章分析，我们知道这里会自动实例化对应的注解类。

这里以`Swoft\Console\Annotation\Mapping\CommandMapping`这个注解为例，对应的注解解析类为`Swoft\Console\Annotation\Parser\CommandMappingParser`。

```
<?php declare(strict_types=1);

namespace Swoft\Console\Annotation\Parser;

use Swoft\Annotation\Annotation\Mapping\AnnotationParser;
use Swoft\Annotation\Annotation\Parser\Parser;
use Swoft\Annotation\Exception\AnnotationException;
use Swoft\Console\Annotation\Mapping\CommandMapping;
use Swoft\Console\CommandRegister;

/**
 * Class CommandMappingParser
 *
 * @since 2.0
 * @AnnotationParser(CommandMapping::class)
 */
class CommandMappingParser extends Parser
{
    /**
     * Parse object
     *
     * @param int            $type Class or Method or Property
     * @param CommandMapping $annotation Annotation object
     *
     * @return array
     * Return empty array is nothing to do!
     * When class type return [$beanName, $className, $scope, $alias, $size] is to inject bean
     * When property type return [$propertyValue, $isRef] is to reference value
     */
    public function parse(int $type, $annotation): array
    {
        if ($type !== self::TYPE_METHOD) {
            throw new AnnotationException('`@CommandMapping` must be defined on class method!');
        }

        $method = $this->methodName;

        // add route info for controller action
        CommandRegister::addRoute($this->className, $method, [
            'command' => $annotation->getName() ?: $method,
            'method'  => $method,
            'alias'   => $annotation->getAlias(),
            'aliases' => $annotation->getAliases(),
            'desc'    => $annotation->getDesc(),
            'usage'   => $annotation->getUsage(),
            // 'example' => $annotation->getExample(),
        ]);

        return [];
    }
}
```

看到这里，你应该可以猜到`CommandRegister`类的`$commands`是怎么来的了吧。

我们看下`CommandRegister`类的`addRoute`方法，验证下想法。

```
/**
    * @param string $class
    * @param string $method
    * @param array  $route
    *
    * @throws AnnotationException
    */
public static function addRoute(string $class, string $method, array $route): void
{
    self::checkClass($class);

    // init some keys
    $route['options']   = [];
    $route['arguments'] = [];
    // save
    self::$commands[$class]['commands'][$method] = $route;
}
```

bingo，跟我们猜想的一模一样，这下我们也知道`CommandMapping`这个注解是用来注册终端的路由信息。

回到`ConsoleProcessor`类，接着看代码。

```
CLog::info(
    'Console command route registered (group %d, command %d)',
    $router->groupCount(),
    $router->count()
);
```

打印日志。

```
// Run console application
bean('cliApp')->run();
```

感觉到了重头戏。

根据前面的代码，我们知道`cliApp`这个`Bean`实例对应的类是`Swoft\Console\Application`。

```
/**
    * @return void
    * @throws ContainerException
    */
public function run(): void
{
    try {
        Swoft::trigger(ConsoleEvent::RUN_BEFORE, $this);

        // Prepare
        $this->prepare();

        // Get input command
        $inputCommand = $this->input->getCommand();

        if (!$inputCommand) {
            $this->filterSpecialOption();
        } else {
            $this->doRun($inputCommand);
        }

        Swoft::trigger(ConsoleEvent::RUN_AFTER, $this, $inputCommand);
    } catch (Throwable $e) {
        /** @var ConsoleErrorDispatcher $errDispatcher */
        $errDispatcher = BeanFactory::getSingleton(ConsoleErrorDispatcher::class);

        // Handle request error
        $errDispatcher->run($e);
    }
}
```

通过`Swoft::trigger`，注册了`ConsoleEvent::RUN_BEFORE`和`ConsoleEvent::RUN_AFTER`两个事件。

```
protected function prepare(): void
{
    $this->input  = \input();
    $this->output = \output();

    // load builtin comments vars
    $this->setCommentsVars($this->commentsVars());
}
```

`prepare`比较简单，这里声明了输入和输出两个类。注意哈，这个后面会用到。

```
$inputCommand = $this->input->getCommand();
if (!$inputCommand) {
    $this->filterSpecialOption();
} else {
    $this->doRun($inputCommand);
}
```

获取终端命令行下的输入，如果有输入执行`doRun`方法。

```
/**
    * @param string $inputCmd
    *
    * @return void
    * @throws ReflectionException
    * @throws ContainerException
    * @throws Throwable
    */
protected function doRun(string $inputCmd): void
{
    $output = $this->output;
    /* @var Router $router */
    $router = Swoft::getBean('cliRouter');
    $result = $router->match($inputCmd);

    // Command not found
    if ($result[0] === Router::NOT_FOUND) {
        $names = $router->getAllNames();
        $output->liteError("The entered command '{$inputCmd}' is not exists!");

        // find similar command names by similar_text()
        if ($similar = Arr::findSimilar($inputCmd, $names)) {
            $output->writef("\nMaybe what you mean is:\n    <info>%s</info>", implode(', ', $similar));
        } else {
            $this->showApplicationHelp(false);
        }
        return;
    }

    $info = $result[1];

    // Only input a group name, display help for the group
    if ($result[0] === Router::ONLY_GROUP) {
        $this->showGroupHelp($info['group']);
        return;
    }

    // Display help for a command
    if ($this->input->getSameOpt(['h', 'help'])) {
        $this->showCommandHelp($info);
        return;
    }

    // Parse default options and arguments
    $this->bindCommandFlags($info);
    $this->input->setCommandId($info['cmdId']);

    Swoft::triggerByArray(ConsoleEvent::DISPATCH_BEFORE, $this, $info);

    // Call command handler
    /** @var ConsoleDispatcher $dispatcher */
    $dispatcher = Swoft::getSingleton('cliDispatcher');
    $dispatcher->dispatch($info);

    Swoft::triggerByArray(ConsoleEvent::DISPATCH_AFTER, $this, $info);
}
```

```
$router = Swoft::getBean('cliRouter');
$result = $router->match($inputCmd);
```

获取`cliRouter`实例，根据输入匹配路由操作类。

```
/**
    * Match route by input command
    *
    * @param array $params [$route]
    *
    * @return array
    *
    * [
    *  status, info(array)
    * ]
    */
public function match(...$params): array
{
    $delimiter = $this->delimiter;
    $inputCmd  = trim($params[0], "$delimiter ");
    $noSepChar = strpos($inputCmd, $delimiter) === false;

    // If use command ID alias
    if ($noSepChar && isset($this->idAliases[$inputCmd])) {
        $inputCmd = $this->idAliases[$inputCmd];
        // Must re-check
        $noSepChar = strpos($inputCmd, $delimiter) === false;
    }

    if ($noSepChar && in_array($inputCmd, $this->defaultCommands, true)) {
        $group   = $this->defaultGroup;
        $command = $this->resolveCommandAlias($inputCmd);

        // Only a group name
    } elseif ($noSepChar) {
        $group = $this->resolveGroupAlias($inputCmd);

        if (isset($this->groups[$group])) {
            return [self::ONLY_GROUP, ['group' => $group]];
        }

        return [self::NOT_FOUND];
    } else {
        $nameList = explode($delimiter, $inputCmd, 2);

        if (count($nameList) === 2) {
            [$group, $command] = $nameList;
            // resolve command alias
            $command = $this->resolveCommandAlias($command);
        } else {
            $command = '';
            // $command = $this->defaultCommand;
            $group = $nameList[0];
        }
    }

    $group = $this->resolveGroupAlias($group);
    // build command ID
    $commandID = $this->buildCommandID($group, $command);

    if (isset($this->routes[$commandID])) {
        $info = $this->routes[$commandID];
        // append some info
        $info['cmdId'] = $commandID;

        return [self::FOUND, $info];
    }

    if ($group && isset($this->groups[$group])) {
        return [self::ONLY_GROUP, ['group' => $group]];
    }

    return [self::NOT_FOUND];
}
```

这里会返回匹配后的路由信息。

回到`doRun`方法。

```
// Command not found
if ($result[0] === Router::NOT_FOUND) {
    $names = $router->getAllNames();
    $output->liteError("The entered command '{$inputCmd}' is not exists!");

    // find similar command names by similar_text()
    if ($similar = Arr::findSimilar($inputCmd, $names)) {
        $output->writef("\nMaybe what you mean is:\n    <info>%s</info>", implode(', ', $similar));
    } else {
        $this->showApplicationHelp(false);
    }
    return;
}

$info = $result[1];

// Only input a group name, display help for the group
if ($result[0] === Router::ONLY_GROUP) {
    $this->showGroupHelp($info['group']);
    return;
}

// Display help for a command
if ($this->input->getSameOpt(['h', 'help'])) {
    $this->showCommandHelp($info);
    return;
}
```

根据返回的路由信息进行不同的处理。

```
// Parse default options and arguments
$this->bindCommandFlags($info);
$this->input->setCommandId($info['cmdId']);

Swoft::triggerByArray(ConsoleEvent::DISPATCH_BEFORE, $this, $info);
```

绑定默认参数，注册`ConsoleEvent::DISPATCH_BEFORE`事件。

```
// Call command handler
/** @var ConsoleDispatcher $dispatcher */
$dispatcher = Swoft::getSingleton('cliDispatcher');
$dispatcher->dispatch($info);
```

获取`cliDispatcher`的`Bean`实例，对应`Swoft\Console\ConsoleDispatcher`类，调用`dispatch`方法。

```
/**
    * @param array $params
    *
    * @return void
    * @throws ReflectionException
    * @throws Throwable
    */
public function dispatch(...$params): void
{
    $route = $params[0];
    // Handler info
    [$className, $method] = $route['handler'];

    // Bind method params
    $params = $this->getBindParams($className, $method);
    $object = Swoft::getSingleton($className);

    // Blocking running
    if (!$route['coroutine']) {
        $this->before(get_parent_class($object), $method);
        PhpHelper::call([$object, $method], ...$params);
        $this->after($method);
        return;
    }

    // Hook php io function
    Runtime::enableCoroutine();

    // If in unit test env, has been in coroutine.
    if (\defined('PHPUNIT_COMPOSER_INSTALL')) {
        $this->executeByCo($object, $method, $params);
        return;
    }

    // Coroutine running
    srun(function () use ($object, $method, $params) {
        $this->executeByCo($object, $method, $params);
    });
}
```

获取路由对应的类和方法，通过`Swoft::getSingleton($className);`实例化对象。

如果未开启协程，则用`PhpHelper::call([$object, $method], ...$params);`调用对应的方法。

开启协程的话，使用`$this->executeByCo($object, $method, $params);`调用对应的方法。

我们前面启动命令是`php bin/swoft http:start`，这里对应的类就是`Swoft\Http\Server\Command\HttpServerCommand`，方法就是`start`。

```
/**
    * Start the http server
    *
    * @CommandMapping(usage="{fullCommand} [-d|--daemon]")
    * @CommandOption("daemon", short="d", desc="Run server on the background", type="bool", default="false")
    *
    * @throws ReflectionException
    * @throws ContainerException
    * @throws ServerException
    * @example
    *   {fullCommand}
    *   {fullCommand} -d
    *
    */
public function start(): void
{
    $server = $this->createServer();

    // Check if it has started
    if ($server->isRunning()) {
        $masterPid = $server->getPid();
        output()->writeln("<error>The HTTP server have been running!(PID: {$masterPid})</error>");
        return;
    }

    // Startup settings
    $this->configStartOption($server);

    $settings = $server->getSetting();
    // Setting
    $workerNum = $settings['worker_num'];

    // Server startup parameters
    $mainHost = $server->getHost();
    $mainPort = $server->getPort();
    $modeName = $server->getModeName();
    $typeName = $server->getTypeName();

    // Http
    $panel = [
        'HTTP' => [
            'listen' => $mainHost . ':' . $mainPort,
            'type'   => $typeName,
            'mode'   => $modeName,
            'worker' => $workerNum,
        ],
    ];

    // Port Listeners
    $panel = $this->appendPortsToPanel($server, $panel);

    Show::panel($panel);

    output()->writeln('<success>HTTP server start success !</success>');

    // Start the server
    $server->start();
}
```

这里先调用了`createServer`方法。

```
/**
    * @return HttpServer
    * @throws ReflectionException
    * @throws ContainerException
    */
private function createServer(): HttpServer
{
    $script  = input()->getScript();
    $command = $this->getFullCommand();

    /** @var HttpServer $server */
    $server = bean('httpServer');
    $server->setScriptFile(Swoft::app()->getPath($script));
    $server->setFullCommand($command);

    return $server;
}
```

获取`httpServer`的`Bean`实例。

框架定义在`swoft-component-2.0.5\src\http-server\src\AutoLoader.php`，这里声明了`onRequest`回调事件。

```
'httpServer'      => [
    'on' => [
        SwooleEvent::REQUEST => bean(RequestListener::class)
    ]
],
```

业务定义在`swoft-2.0.5\app\bean.php`。

```
'httpServer'        => [
    'class'    => HttpServer::class,
    'port'     => 18306,
    'listener' => [
        'rpc' => bean('rpcServer')
    ],
    'process'  => [
//            'monitor' => bean(MonitorProcess::class)
//            'crontab' => bean(CrontabProcess::class)
    ],
    'on'       => [
//            SwooleEvent::TASK   => bean(SyncTaskListener::class),  // Enable sync task
        SwooleEvent::TASK   => bean(TaskListener::class),  // Enable task must task and finish event
        SwooleEvent::FINISH => bean(FinishListener::class)
    ],
    /* @see HttpServer::$setting */
    'setting'  => [
        'task_worker_num'       => 12,
        'task_enable_coroutine' => true
    ]
],
```

`createServer`返回的是一个`Swoft\Http\Server\HttpServer`实例。

回到`HttpServerCommand`类的`start`方法。

```
// Start the server
$server->start();
```

调用`Swoft\Http\Server\HttpServer`类的`start`方法。

```
/**
    * Start server
    *
    * @throws ServerException
    * @throws ContainerException
    */
public function start(): void
{
    $this->swooleServer = new \Swoole\Http\Server($this->host, $this->port, $this->mode, $this->type);
    $this->startSwoole();
}
```

声明`Swoole\Http\Server`对象，调用`startSwoole`方法。

`Swoft\Http\Server\HttpServer`类继承自`Swoft\Server\Server`类，`startSwoole`方法定义在这个类。

```
/**
    * Bind swoole event and start swoole server
    *
    * @throws ServerException
    * @throws Swoft\Bean\Exception\ContainerException
    */
protected function startSwoole(): void
{
    if (!$this->swooleServer) {
        throw new ServerException('You must to new server before start swoole!');
    }

    // Always enable coroutine hook on server
    CLog::info('Swoole\Runtime::enableCoroutine');
    Runtime::enableCoroutine();

    Swoft::trigger(ServerEvent::BEFORE_SETTING, $this);

    // Set settings
    $this->swooleServer->set($this->setting);
    // Update setting property
    // $this->setSetting($this->swooleServer->setting);

    // Before Add event
    Swoft::trigger(ServerEvent::BEFORE_ADDED_EVENT, $this);

    // Register events
    $defaultEvents = $this->defaultEvents();
    $swooleEvents  = array_merge($defaultEvents, $this->on);

    // Add events
    $this->addEvent($this->swooleServer, $swooleEvents, $defaultEvents);

    //After add event
    Swoft::trigger(ServerEvent::AFTER_ADDED_EVENT, $this);

    // Before listener
    Swoft::trigger(ServerEvent::BEFORE_ADDED_LISTENER, $this);

    // Add port listener
    $this->addListener();

    // Before bind process
    Swoft::trigger(ServerEvent::BEFORE_ADDED_PROCESS, $this);

    // Add Process
    Swoft::trigger(ServerEvent::ADDED_PROCESS, $this);

    // After bind process
    Swoft::trigger(ServerEvent::AFTER_ADDED_PROCESS, $this);

    // Trigger event
    Swoft::trigger(ServerEvent::BEFORE_START, $this, array_keys($swooleEvents));

    // Storage server instance
    self::$server = $this;

    // Start swoole server
    $this->swooleServer->start();
}
```

```
$this->swooleServer->set($this->setting);
```

设置`Swoole`运行配置。

```
// Register events
$defaultEvents = $this->defaultEvents();
$swooleEvents  = array_merge($defaultEvents, $this->on);

// Add events
$this->addEvent($this->swooleServer, $swooleEvents, $defaultEvents);
```

添加`Swoole`回调事件。

```
// Add port listener
$this->addListener();
```

监听端口。

```
// Start swoole server
$this->swooleServer->start();
```

启动`Swoole\Http\Server`服务。

现在服务已经启动了，那`http请求`是怎么被处理的呢？

这个我们下一篇再继续讲。