---
title: "Swoft 框架运行分析（三） —— BeanProcessor模块分析"
date: 2019-09-02T18:29:06+08:00
draft: false
keywords: Swoft
---

今天讲一下`BeanProcessor`模块，先看一下`handle`方法实现。

```
    /**
     * Handle bean
     *
     * @return bool
     * @throws ReflectionException
     * @throws AnnotationException
     */
    public function handle(): bool
    {
        if (!$this->application->beforeBean()) {
            return false;
        }

        $handler     = new BeanHandler();
        $definitions = $this->getDefinitions();
        $parsers     = AnnotationRegister::getParsers();
        $annotations = AnnotationRegister::getAnnotations();

        BeanFactory::addDefinitions($definitions);
        BeanFactory::addAnnotations($annotations);
        BeanFactory::addParsers($parsers);
        BeanFactory::setHandler($handler);
        BeanFactory::init();

        /* @var Config $config*/
        $config = BeanFactory::getBean('config');

        CLog::info('config path=%s', $config->getPath());
        CLog::info('config env=%s', $config->getEnv());

        $stats = BeanFactory::getStats();

        CLog::info('Bean is initialized(%s)', SwoftHelper::formatStats($stats));

        return $this->application->afterBean();
    }
```

先通过`getDefinitions`方法获取所有的Bean定义。

```
    /**
     * Get bean definitions
     *
     * @return array
     */
    private function getDefinitions(): array
    {
        // Core beans
        $definitions = [];
        $autoLoaders = AnnotationRegister::getAutoLoaders();

        // get disabled loaders by application
        $disabledLoaders = $this->application->getDisabledAutoLoaders();

        foreach ($autoLoaders as $autoLoader) {
            if (!$autoLoader instanceof DefinitionInterface) {
                continue;
            }

            $loaderClass = get_class($autoLoader);

            // If the component is disabled by user.
            if (isset($disabledLoaders[$loaderClass])) {
                CLog::info('Auto loader(%s) is <cyan>disabled</cyan>, skip handle it', $loaderClass);
                continue;
            }

            // If the component is not enabled.
            if ($autoLoader instanceof ComponentInterface && !$autoLoader->isEnable()) {
                continue;
            }

            $definitions = ArrayHelper::merge($definitions, $autoLoader->beans());
        }

        // Bean definitions
        $beanFile = $this->application->getBeanFile();
        $beanFile = alias($beanFile);

        if (!file_exists($beanFile)) {
            throw new InvalidArgumentException(
                sprintf('The bean config file of %s is not exist!', $beanFile)
            );
        }

        $beanDefinitions = require $beanFile;
        $definitions     = ArrayHelper::merge($definitions, $beanDefinitions);

        return $definitions;
    }
```

通过`AnnotationRegister::getAutoLoaders()`拿到所有的autoloader对象，排除掉非`DefinitionInterface`对象，通过`bean()`方法获取定义的Bean信息。

这里以`http-server\src\AutoLoader.php`为例。

```
<?php declare(strict_types=1);

namespace Swoft\Http\Server;

use function bean;
use function dirname;
use ReflectionException;
use Swoft\Bean\Exception\ContainerException;
use Swoft\Helper\ComposerJSON;
use Swoft\Http\Message\ContentType;
use Swoft\Http\Message\Response;
use Swoft\Http\Server\Formatter\HtmlResponseFormatter;
use Swoft\Http\Server\Formatter\JsonResponseFormatter;
use Swoft\Http\Server\Formatter\XmlResponseFormatter;
use Swoft\Http\Server\Parser\JsonRequestParser;
use Swoft\Http\Server\Parser\XmlRequestParser;
use Swoft\Http\Server\Swoole\RequestListener;
use Swoft\Server\SwooleEvent;
use Swoft\SwoftComponent;

/**
 * Class AutoLoader
 *
 * @since 2.0
 */
class AutoLoader extends SwoftComponent
{
    /**
     * Metadata information for the component.
     *
     * @return array
     * @see ComponentInterface::getMetadata()
     */
    public function metadata(): array
    {
        $jsonFile = dirname(__DIR__) . '/composer.json';

        return ComposerJSON::open($jsonFile)->getMetadata();
    }

    /**
     * Get namespace and dirs
     *
     * @return array
     */
    public function getPrefixDirs(): array
    {
        return [
            __NAMESPACE__ => __DIR__,
        ];
    }

    /**
     * @return array
     * @throws ReflectionException
     * @throws ContainerException
     */
    public function beans(): array
    {
        return [
            'httpRequest'     => [
                'parsers' => [
                    ContentType::XML  => bean(XmlRequestParser::class),
                    ContentType::JSON => bean(JsonRequestParser::class),
                ]
            ],
            'httpResponse'    => [
                'format'     => Response::FORMAT_JSON,
                'formatters' => [
                    Response::FORMAT_HTML => bean(HtmlResponseFormatter::class),
                    Response::FORMAT_JSON => bean(JsonResponseFormatter::class),
                    Response::FORMAT_XML  => bean(XmlResponseFormatter::class),
                ]
            ],
            'acceptFormatter' => [
                'formats' => [
                    ContentType::JSON => Response::FORMAT_JSON,
                    ContentType::HTML => Response::FORMAT_HTML,
                    ContentType::XML  => Response::FORMAT_XML,
                ]
            ],
            'httpServer'      => [
                'on' => [
                    SwooleEvent::REQUEST => bean(RequestListener::class)
                ]
            ],
            'httpRouter'      => [
                'name'            => 'swoft-http-router',
                // config
                'ignoreLastSlash' => true,
                'tmpCacheNumber'  => 500,
            ],
        ];
    }
}
```

可以看到，这里通过`beans()`定义了`httpRequest`、`httpResponse`、`acceptFormatter`、`httpServer`和`httpRouter`四个Bean对象。

回到上面`getDefinitions`方法。

`$definitions = ArrayHelper::merge($definitions, $autoLoader->beans());`

然后将Bean信息添加到`definitions`对象上。

之后通过`$beanFile = $this->application->getBeanFile();`获取bean配置文件。

```
$beanDefinitions = require $beanFile;
$definitions     = ArrayHelper::merge($definitions, $beanDefinitions);
```

加载配置文件，然后将Bean信息添加到`definitions`对象上。

可以看到Bean有两种定义方式：通过AutoLoader和配置文件，与[swoft官方文档](https://en.swoft.org/docs/2.x/zh-CN/bean/bean.html)里的说明一致。

回到`handle`方法。

```
$parsers     = AnnotationRegister::getParsers();
$annotations = AnnotationRegister::getAnnotations();
```

还记得上一篇文章最后提到的`AnnotationRegister`类的`annotations`和`parsers`两个属性吗？这里通过`getParsers`和`getAnnotations`获取这两个属性。

```
BeanFactory::addDefinitions($definitions);
BeanFactory::addAnnotations($annotations);
BeanFactory::addParsers($parsers);
BeanFactory::setHandler($handler);
BeanFactory::init();
```

向BeanFatory注册信息。

```
    /**
     * Init
     *
     * @return void
     * @throws AnnotationException
     * @throws ReflectionException
     */
    public static function init(): void
    {
        Container::getInstance()->init();
    }

    ...

    /**
     * Add definitions
     *
     * @param array $definitions
     *
     * @return void
     */
    public static function addDefinitions(array $definitions): void
    {
        Container::getInstance()->addDefinitions($definitions);
    }

    /**
     * Add annotations
     *
     * @param array $annotations
     *
     * @return void
     */
    public static function addAnnotations(array $annotations): void
    {
        Container::getInstance()->addAnnotations($annotations);
    }

    /**
     * Add annotation parsers
     *
     * @param array $annotationParsers
     *
     * @return void
     */
    public static function addParsers(array $annotationParsers): void
    {
        Container::getInstance()->addParsers($annotationParsers);
    }

    /**
     * Set bean handler
     *
     * @param HandlerInterface $handler
     */
    public static function setHandler(HandlerInterface $handler): void
    {
        Container::getInstance()->setHandler($handler);
    }
```

这里可以看到所有的方法，最终都调用的是`Swoft\Bean\Container`类。

```
    /**
     * Add definitions
     *
     * @param array $definitions
     *
     * @return void
     */
    public function addDefinitions(array $definitions): void
    {
        $this->definitions = ArrayHelper::merge($this->definitions, $definitions);
    }

    /**
     * Add annotations
     *
     * @param array $annotations
     *
     * @return void
     */
    public function addAnnotations(array $annotations): void
    {
        $this->annotations = ArrayHelper::merge($this->annotations, $annotations);
    }

    /**
     * Add annotation parsers
     *
     * @param array $annotationParsers
     *
     * @return void
     */
    public function addParsers(array $annotationParsers): void
    {
        $this->parsers = ArrayHelper::merge($this->parsers, $annotationParsers);
    }

    
    /**
     * @param HandlerInterface $handler
     */
    public function setHandler(HandlerInterface $handler): void
    {
        $this->handler = $handler;
    }
```

这四个方法就是注册属性，接下来是重头戏`init`方法。

```
    /**
     * Init
     *
     * @throws AnnotationException
     * @throws ReflectionException
     */
    public function init(): void
    {
        // Parse annotations
        $this->parseAnnotations();

        // Parse definitions
        $this->parseDefinitions();

        // Init beans
        $this->initializeBeans();
    }
```

先看`parseAnnotations`方法，从代码注释上也可以看出大概，解析注解，接下来我们看下具体是如何实现的。

```
    /**
     * Parse annotations
     *
     * @throws AnnotationException
     */
    private function parseAnnotations(): void
    {
        $annotationParser = new AnnotationObjParser(
            $this->definitions, $this->objectDefinitions, $this->classNames, $this->aliases
        );
        $annotationData   = $annotationParser->parseAnnotations($this->annotations, $this->parsers);

        [$this->definitions, $this->objectDefinitions, $this->classNames, $this->aliases] = $annotationData;
    }
```

声明了一个`AnnotationObjParser`对象，调用了`parseAnnotations`方法。

```
    /**
     * Parse annotations
     *
     * @param array $annotations
     * @param array $parsers
     *
     * @return array
     * @throws AnnotationException
     */
    public function parseAnnotations(array $annotations, array $parsers): array
    {
        $this->parsers     = $parsers;
        $this->annotations = $annotations;

        foreach ($this->annotations as $loadNameSpace => $classes) {
            foreach ($classes as $className => $classOneAnnotations) {
                $this->parseOneClassAnnotations($className, $classOneAnnotations);
            }
        }

        return [$this->definitions, $this->objectDefinitions, $this->classNames, $this->aliases];
    }
```

这里遍历所有的`annotation`类，循环调用`parseOneClassAnnotations`进行解析。

```
    /**
     * Parse class all annotations
     *
     * @param string $className
     * @param array  $classOneAnnotations
     *
     * @throws AnnotationException
     */
    private function parseOneClassAnnotations(string $className, array $classOneAnnotations): void
    {
        // Check class annotation tag
        if (!isset($classOneAnnotations['annotation'])) {
            throw new AnnotationException(
                sprintf('Property or method(%s) with `@xxx` must be define class annotation', $className)
            );
        }

        // Parse class annotations
        $classAnnotations = $classOneAnnotations['annotation'];
        $reflectionClass  = $classOneAnnotations['reflection'];

        $classAry = [
            $className,
            $reflectionClass,
            $classAnnotations
        ];

        $objectDefinition = $this->parseClassAnnotations($classAry);

        // Parse property annotations
        $propertyInjects        = [];
        $propertyAllAnnotations = $classOneAnnotations['properties'] ?? [];
        foreach ($propertyAllAnnotations as $propertyName => $propertyOneAnnotations) {
            $proAnnotations = $propertyOneAnnotations['annotation'] ?? [];
            $propertyInject = $this->parsePropertyAnnotations($classAry, $propertyName, $proAnnotations);
            if ($propertyInject) {
                $propertyInjects[$propertyName] = $propertyInject;
            }
        }

        // Parse method annotations
        $methodInjects        = [];
        $methodAllAnnotations = $classOneAnnotations['methods'] ?? [];
        foreach ($methodAllAnnotations as $methodName => $methodOneAnnotations) {
            $methodAnnotations = $methodOneAnnotations['annotation'] ?? [];

            $methodInject = $this->parseMethodAnnotations($classAry, $methodName, $methodAnnotations);
            if ($methodInject) {
                $methodInjects[$methodName] = $methodInject;
            }
        }

        if (!$objectDefinition) {
            return;
        }

        if (!empty($propertyInjects)) {
            $objectDefinition->setPropertyInjections($propertyInjects);
        }

        if (!empty($methodInjects)) {
            $objectDefinition->setMethodInjections($methodInjects);
        }

        // Object definition and class name
        $name         = $objectDefinition->getName();
        $aliase       = $objectDefinition->getAlias();
        $classNames   = $this->classNames[$className] ?? [];
        $classNames[] = $name;

        $this->classNames[$className]   = array_unique($classNames);
        $this->objectDefinitions[$name] = $objectDefinition;

        if (!empty($aliase)) {
            $this->aliases[$aliase] = $name;
        }
    }
```

这里可以看到分别有类注解、属性注解和方法注解三类。

对应官方文档的[注解说明](https://en.swoft.org/docs/2.x/zh-CN/annotation/index.html#%E8%A7%84%E8%8C%83)。

```
    /**
     * @param array $classAry
     *
     * @return ObjectDefinition|null
     */
    private function parseClassAnnotations(array $classAry): ?ObjectDefinition
    {
        [, , $classAnnotations] = $classAry;

        $objectDefinition = null;
        foreach ($classAnnotations as $annotation) {
            $annotationClass = get_class($annotation);
            if (!isset($this->parsers[$annotationClass])) {
                continue;
            }

            $parserClassName  = $this->parsers[$annotationClass];
            $annotationParser = $this->getAnnotationParser($classAry, $parserClassName);

            $data = $annotationParser->parse(Parser::TYPE_CLASS, $annotation);
            if (empty($data)) {
                continue;
            }

            if (count($data) !== 4) {
                throw new InvalidArgumentException(sprintf('%s annotation parse must be 4 size', $annotationClass));
            }

            [$name, $className, $scope, $alias] = $data;
            $name = empty($name) ? $className : $name;

            if (empty($className)) {
                throw new InvalidArgumentException(sprintf('%s with class name can not be empty', $annotationClass));
            }

            // Multiple coverage
            $objectDefinition = new ObjectDefinition($name, $className, $scope, $alias);
        }

        return $objectDefinition;
    }
```

类注解，这里会调用对应解析类的`parse`方法。

这里以`websocket-server\src\Annotation\Mapping\WsModule.php`和`websocket-server\src\Annotation\Parser\WsModuleParser.php`为例。

```
<?php declare(strict_types=1);

namespace Swoft\WebSocket\Server\Annotation\Mapping;

use Doctrine\Common\Annotations\Annotation\Attribute;
use Doctrine\Common\Annotations\Annotation\Attributes;
use Doctrine\Common\Annotations\Annotation\Required;
use Doctrine\Common\Annotations\Annotation\Target;
use Swoft\WebSocket\Server\MessageParser\RawTextParser;

/**
 * Class WebSocket - mark an websocket module handler class
 *
 * @since 2.0
 *
 * @Annotation
 * @Target("CLASS")
 * @Attributes(
 *     @Attribute("name", type="string"),
 *     @Attribute("path", type="string"),
 *     @Attribute("controllers", type="array"),
 *     @Attribute("messageParser", type="string"),
 * )
 */
final class WsModule
{
    /**
     * Websocket route path.(it must unique in a application)
     *
     * @var string
     * @Required()
     */
    private $path = '/';

    /**
     * Module name.
     *
     * @var string
     */
    private $name = '';

    /**
     * Routing path params binding. eg. {"id"="\d+"}
     *
     * @var array
     */
    private $params = [];

    /**
     * Message controllers of the module
     *
     * @var string[]
     */
    private $controllers = [];

    /**
     * Message parser class for the module
     *
     * @var string
     */
    private $messageParser = RawTextParser::class;

    /**
     * Default message command. Format 'controller.action'
     *
     * @var string
     */
    private $defaultCommand = 'home.index';

    /**
     * Default message opcode for response. please see WEBSOCKET_OPCODE_*
     *
     * @var int
     */
    private $defaultOpcode = 0;

    /**
     * Class constructor.
     *
     * @param array $values
     */
    public function __construct(array $values)
    {
        if (isset($values['value'])) {
            $this->path = (string)$values['value'];
        } elseif (isset($values['path'])) {
            $this->path = (string)$values['path'];
        }

        if (isset($values['name'])) {
            $this->name = (string)$values['name'];
        }

        if (isset($values['params'])) {
            $this->params = (array)$values['params'];
        }

        if (isset($values['controllers'])) {
            $this->controllers = (array)$values['controllers'];
        }

        if (isset($values['messageParser'])) {
            $this->messageParser = $values['messageParser'];
        }

        if (isset($values['defaultOpcode'])) {
            $this->defaultOpcode = (int)$values['defaultOpcode'];
        }

        if (isset($values['defaultCommand'])) {
            $this->defaultCommand = $values['defaultCommand'];
        }
    }

    /**
     * @return string
     */
    public function getPath(): string
    {
        return $this->path;
    }

    /**
     * @return string
     */
    public function getMessageParser(): string
    {
        return $this->messageParser;
    }

    /**
     * @return string
     */
    public function getDefaultCommand(): string
    {
        return $this->defaultCommand;
    }

    /**
     * @return string
     */
    public function getName(): string
    {
        return $this->name;
    }

    /**
     * @return string[]
     */
    public function getControllers(): array
    {
        return $this->controllers;
    }

    /**
     * @return array
     */
    public function getParams(): array
    {
        return $this->params;
    }

    /**
     * @return int
     */
    public function getDefaultOpcode(): int
    {
        return $this->defaultOpcode;
    }
}
```

`WsModule`声明了一个类注解。

```
<?php declare(strict_types=1);

namespace Swoft\WebSocket\Server\Annotation\Parser;

use Swoft\Annotation\Annotation\Mapping\AnnotationParser;
use Swoft\Annotation\Annotation\Parser\Parser;
use Swoft\Annotation\Exception\AnnotationException;
use Swoft\Bean\Annotation\Mapping\Bean;
use Swoft\Stdlib\Helper\Str;
use Swoft\WebSocket\Server\Annotation\Mapping\WsModule;
use Swoft\WebSocket\Server\MessageParser\RawTextParser;
use Swoft\WebSocket\Server\Router\RouteRegister;

/**
 * Class WebSocketParser
 *
 * @since 2.0
 *
 * @AnnotationParser(WsModule::class)
 */
class WsModuleParser extends Parser
{
    /**
     * Parse object
     *
     * @param int      $type Class or Method or Property
     * @param WsModule $ann  Annotation object
     *
     * @return array
     * Return empty array is nothing to do!
     * When class type return [$beanName, $className, $scope, $alias, $size] is to inject bean
     * When property type return [$propertyValue, $isRef] is to reference value
     * @throws AnnotationException
     */
    public function parse(int $type, $ann): array
    {
        if ($type !== self::TYPE_CLASS) {
            throw new AnnotationException('`@WsModule` must be defined on class!');
        }

        $class = $this->className;

        RouteRegister::bindModule($class, [
            'path'           => $ann->getPath() ?: Str::getClassName($class, 'Module'),
            'name'           => $ann->getName(),
            'params'         => $ann->getParams(),
            'class'          => $class,
            'eventMethods'   => [],
            'controllers'    => $ann->getControllers(),
            'messageParser'  => $ann->getMessageParser() ?: RawTextParser::class,
            'defaultOpcode' => $ann->getDefaultOpcode(),
            'defaultCommand' => $ann->getDefaultCommand(),
        ]);

        return [$class, $class, Bean::SINGLETON, ''];
    }
}
```

按上一篇文章说明，这里`WsModuleParser`会被标记为注解类`WsModule`的注解解析类。

解析注解的时候，会调用`WsModuleParser`的`parse`方法，这里通过`RouteRegister::bindModule`做了一些路由操作，这里后续再讲，这里不做深入介绍。

属性和方法注解，也是类似的，`parseAnnotations`方法就讲完了。

回到`Container`类的`init`方法，接下来调用了`parseDefinitions`方法。

```
    /**
     * Parse definitions
     */
    private function parseDefinitions(): void
    {
        $annotationParser = new DefinitionObjParser(
            $this->definitions, $this->objectDefinitions, $this->classNames, $this->aliases
        );

        // Collect info
        $definitionData = $annotationParser->parseDefinitions();
        [$this->definitions, $this->objectDefinitions, $this->classNames, $this->aliases] = $definitionData;
    }
```

声明了一个`DefinitionObjParser`对象，调用了`parseDefinitions`方法。

```
    /**
     * Parse definitions
     *
     * @return array
     */
    public function parseDefinitions(): array
    {
        foreach ($this->definitions as $beanName => $definition) {
            if (isset($this->objectDefinitions[$beanName])) {
                $objectDefinition = $this->objectDefinitions[$beanName];
                $this->resetObjectDefinition($beanName, $objectDefinition, $definition);
                continue;
            }

            $this->createObjectDefinition($beanName, $definition);
        }

        return [$this->definitions, $this->objectDefinitions, $this->classNames, $this->aliases];
    }
```

遍历所有的`Bean`对象，调用`createObjectDefinition`方法。

```
    /**
     * Create object definition for definition
     *
     * @param string $beanName
     * @param array  $definition
     */
    private function createObjectDefinition(string $beanName, array $definition): void
    {
        $className = $definition['class'] ?? '';
        if (empty($className)) {
            throw new InvalidArgumentException(sprintf('%s key for definition must be defined class', $beanName));
        }

        $objDefinition = new ObjectDefinition($beanName, $className);
        $objDefinition = $this->updateObjectDefinitionByDefinition($objDefinition, $definition);

        $classNames   = $this->classNames[$className] ?? [];
        $classNames[] = $beanName;

        $this->classNames[$className]       = array_unique($classNames);
        $this->objectDefinitions[$beanName] = $objDefinition;
    }
```

声明了`ObjectDefinition`对象，调用了`updateObjectDefinitionByDefinition`方法。

```
    /**
     * Update definition
     *
     * @param ObjectDefinition $objDfn
     * @param array            $definition
     *
     * @return ObjectDefinition
     */
    private function updateObjectDefinitionByDefinition(ObjectDefinition $objDfn, array $definition): ObjectDefinition
    {
        [$constructInject, $propertyInjects, $option] = $this->parseDefinition($definition);

        // Set construct inject
        if (!empty($constructInject)) {
            $objDfn->setConstructorInjection($constructInject);
        }

        // Set property inject
        foreach ($propertyInjects as $propertyName => $propertyInject) {
            $objDfn->setPropertyInjection($propertyName, $propertyInject);
        }

        $scopes = [
            Bean::SINGLETON,
            Bean::PROTOTYPE,
            Bean::REQUEST,
        ];

        $scope = $option['scope'] ?? '';
        $alias = $option['alias'] ?? '';

        if (!empty($scope) && !in_array($scope, $scopes, true)) {
            throw new InvalidArgumentException('Scope for definition is not undefined');
        }

        // Update scope
        if (!empty($scope)) {
            $objDfn->setScope($scope);
        }

        // Update alias
        if (!empty($alias)) {
            $objDfn->setAlias($alias);

            $objAlias = $objDfn->getAlias();
            unset($this->aliases[$objAlias]);

            $this->aliases[$alias] = $objDfn->getName();
        }

        return $objDfn;
    }
```

这里调用了`parseDefinition`方法进行解析。

```
    /**
     * Parse definition
     *
     * @param array $definition
     *
     * @return array
     */
    private function parseDefinition(array $definition): array
    {
        // Remove class key
        unset($definition['class']);

        // Parse construct
        $constructArgs = $definition[0] ?? [];
        if (!is_array($constructArgs)) {
            throw new InvalidArgumentException('Construct args for definition must be array');
        }

        // Parse construct args
        $argInjects = [];
        foreach ($constructArgs as $arg) {
            [$argValue, $argIsRef] = $this->getValueByRef($arg);

            $argInjects[] = new ArgsInjection($argValue, $argIsRef);
        }

        // Set construct inject
        $constructInject = null;
        if (!empty($argInjects)) {
            $constructInject = new MethodInjection('__construct', $argInjects);
        }

        // Remove construct definition
        unset($definition[0]);

        // Parse definition option
        $option = $definition['__option'] ?? [];
        if (!is_array($option)) {
            throw new InvalidArgumentException('__option for definition must be array');
        }

        // Remove `__option`
        unset($definition['__option']);

        // Parse definition properties
        $propertyInjects = [];
        foreach ($definition as $propertyName => $propertyValue) {
            if (!is_string($propertyName)) {
                throw new InvalidArgumentException('Property key from definition must be string');
            }

            [$proValue, $proIsRef] = $this->getValueByRef($propertyValue);

            // Parse property for array
            if (is_array($proValue)) {
                $proValue = $this->parseArrayProperty($proValue);
            }

            $propertyInject = new PropertyInjection($propertyName, $proValue, $proIsRef);

            $propertyInjects[$propertyName] = $propertyInject;
        }

        return [$constructInject, $propertyInjects, $option];
    }
```

解析`__construct`方法和传参，解析属性信息。

回到`updateObjectDefinitionByDefinition`方法，将`__construct`和类属性信息注册到`ObjectDefinition`对象上，到这里`parseDefinitions`方法执行完毕。

回到`Container`类的`init`方法，接下来调用了`initializeBeans`方法。

```
    /**
     * Initialize beans
     *
     * @throws InvalidArgumentException
     * @throws ReflectionException
     */
    private function initializeBeans(): void
    {
        /* @var ObjectDefinition $objectDefinition */
        foreach ($this->objectDefinitions as $beanName => $objectDefinition) {
            $scope = $objectDefinition->getScope();
            // Exclude request
            if ($scope === Bean::REQUEST) {
                $this->requestDefinitions[$beanName] = $objectDefinition;
                unset($this->objectDefinitions[$beanName]);
                continue;
            }

            // Exclude session
            if ($scope === Bean::SESSION) {
                $this->sessionDefinitions[$beanName] = $objectDefinition;
                unset($this->objectDefinitions[$beanName]);
                continue;
            }

            // New bean
            $this->newBean($beanName);
        }
    }
```

对于`scope`不为`Bean::REQUEST`和`Bean::SESSION`的，调用`newBean`方法。

```
    /**
     * Initialize beans
     *
     * @param string $beanName
     * @param string $id
     *
     * @return object
     * @throws ReflectionException
     */
    private function newBean(string $beanName, string $id = '')
    {
        // First, check bean whether has been create.
        if (isset($this->singletonPool[$beanName]) || isset($this->prototypePool[$beanName])) {
            return $this->get($beanName);
        }

        // Get object definition
        $objectDefinition = $this->getNewObjectDefinition($beanName);

        $scope     = $objectDefinition->getScope();
        $alias     = $objectDefinition->getAlias();
        $className = $objectDefinition->getClassName();

        // Cache reflection class info
        Reflections::cache($className);

        // Before initialize bean
        $this->beforeInit($beanName, $className, $objectDefinition);

        $constructArgs   = [];
        $constructInject = $objectDefinition->getConstructorInjection();
        if ($constructInject !== null) {
            $constructArgs = $this->getConstructParams($constructInject, $id);
        }

        $propertyInjects = $objectDefinition->getPropertyInjections();

        // Proxy class
        if ($this->handler) {
            $className = $this->handler->classProxy($className);
        }

        $reflectionClass = new ReflectionClass($className);
        $reflectObject   = $this->newInstance($reflectionClass, $constructArgs);

        // Inject properties values
        $this->newProperty($reflectObject, $reflectionClass, $propertyInjects, $id);

        // Alias
        if (!empty($alias)) {
            $this->aliases[$alias] = $beanName;
        }

        // Call init method if exist
        if ($reflectionClass->hasMethod(self::INIT_METHOD)) {
            $reflectObject->{self::INIT_METHOD}();
        }

        return $this->setNewBean($beanName, $scope, $reflectObject, $id);
    }
```

通过反射实例化`Bean`对应的类，注册对应的属性。

如果类存在`self::INIT_METHOD`方法，执行此方法。

```
    /**
     * @param string $beanName
     * @param string $scope
     * @param object $object
     * @param string $id
     *
     * @return object
     */
    private function setNewBean(string $beanName, string $scope, $object, string $id = '')
    {
        switch ($scope) {
            case Bean::SINGLETON: // Singleton
                $this->singletonPool[$beanName] = $object;
                break;
            case Bean::PROTOTYPE:
                $this->prototypePool[$beanName] = $object;
                // Clone it
                $object = clone $object;
                break;
            case Bean::REQUEST:
                $this->requestPool[$id][$beanName] = $object;
                break;
            case Bean::SESSION:
                $this->sessionPool[$id][$beanName] = $object;
                break;
        }

        return $object;
    }
```

`setNewBean`方法，根据对应的scope信息，将实例化后的反射类注册到对应的类属性上。

到这里`BeanProcessor`类就执行完了。