---
title: 'Laravel 예외 처리 전략 1편'
description: 'PHPStorm Checked Exception 활용하기'
pubDate: 'Jul 31 2025'
tags: ['Checked Exception', 'exception', 'laravel', 'php', 'phpstorm']
---

# 예외를 구분하기

나는 개발을 할 때 크게 예외를 둘로 나눈다.

## 1. 비즈니스 예외

비즈니스 예외란, 비즈니스 규칙/조건을 위반하는 경우에 발생하는 예외다. (ex. 중복 주문, 유효하지 않은 상태)

```php
namespace App\Services;

use App\Models\User;
use App\Exceptions\NotEnoughPointsException;

class OrderService
{
    public function purchase(User $user, int $amount): void
    {
        // 비즈니스 규칙 "포인트가 결제 금액보다 적으면 결제 할 수 없다."
        if ($user->points < $amount) {
            throw new NotEnoughPointsException("포인트가 부족합니다."); // 비즈니스 예외 throw
        }
        // 실제 결제 로직...
        $user->points -= $amount;
        $user->save();
    }
}
```

## 2. 시스템/기술적 예외

시스템/기술적 예외는 비즈니스 예외를 제외한 나머지 예외들로 보통 다음 목록과 같지만, 요구사항에 따라 비즈니스 예외로 래핑하는 경우도 있다. (ex. `Guzzle`로 외부 API를 호출하여 응답 코드나 응답 본문에 따라 비즈니스 예외로 래핑)

| **특징**        | **예시**                                           |
| --------------- | -------------------------------------------------- |
| DB 접속 장애    | DB 서버 다운, 연결 실패                            |
| 외부 API 장애   | 타사 결제 게이트웨이 오류                          |
| 네트워크 문제   | 네트워크 타임아웃, DNS 오류                        |
| 프로그래밍 오류 | null 호출, 타입 오류, 존재하지 않는 메서드 호출 등 |
| 권한 문제       | 파일 읽기/쓰기 권한 부족                           |
| 서버 자원 부족  | 메모리 부족, 디스크 공간 부족                      |

```php
namespace App\Services;

use App\Models\User;
use Illuminate\Database\QueryException;
use RuntimeException;

class UserService
{
    public function updateEmail(int $userId, string $newEmail): void
    {
        try {
            $user = User::findOrFail($userId);
            $user->email = $newEmail;
            $user->save();
        } catch (QueryException $e) {
            // DB 연결 오류, SQL 구문 오류 등
            throw new RuntimeException("이메일 저장 중 시스템 오류 발생", 0, $e);
        }
    }
}
```

예외 분류는 UX와도 연관되는데, 일반적으로 HTTP 응답 코드를 비즈니스 예외는 4xx를, 나머지 예외는 5xx로 응답하는 경우가 많다. Laravel Form Request Validation 실패 시 422 응답을 반환하는 것을 생각하면 된다. (인증, 인가, Notfound 등도 마찬가지다.)

비즈니스 예외는 보통 **사용자 행동이나 비즈니스 모델 상태**와 연관이 되어 있기 때문에 위 예시처럼 "포인트가 부족합니다."와 같은 메시지를 사용자에게 전달하여, 사용자가 문제를 이해하고 스스로 해결할 수 있도록 도와줄 필요가 있다.

## 예외를 어디서 처리해야 하는가?

Laravel은 기본적으로 `Illuminate\Foundation\Exceptions\Handler` 클래스를 통한 중앙 집중식 예외 처리를 권장하고, 나 또한 해당 방식으로 예외를 상위로 전파하는 것을 선호한다.

비즈니스 요구사항이나 필요에 의해 try-catch-finally를 사용하는 경우들도 있지만, 이는 이미 여러분이 알아서 잘 구분해서 작성하리라 생각한다.

```php
public function sendBulkNotifications($users)
{
    $successCount = 0;
    $failedUsers = [];

    foreach ($users as $user) {
        // 상위로 전파하면 bulk 작업 시, 하나가 실패하면 전체가 실패
        // 물론 전체가 실패해야 하는 경우가 있지만, 항상 "필요하면"이 전제됨
        try {
            $this->sendNotification($user);
            $successCount++;
        } catch (Exception $e) {
            // 개별 실패는 기록하고 계속 진행
            $failedUsers[] = $user->id;
        }
    }

    return [
        'success' => $successCount,
        'failed' => $failedUsers
    ];
}
```

상위로 전파를 통한 전역 핸들러에서 처리하는 방식은 로깅, 알림, 응답 형식 등의 작업을 중복 코드를 작성하지 않고 일관되게 처리가 가능하다. (실전에서는 내부용 예외 클래스를 laravel-lang과 통합이나 `Illuminate\Contracts\Support\Renderable`를 구현한 예외로 다시 래핑하는 등 더 복잡한 경우가 많지만 여기서는 간단히 구현했다.)

```php
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use App\Exceptions\BusinessException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        //
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // 비즈니스 예외 처리
        $exceptions->render(function (BusinessException $e, $request) {
            return response()->json([
                'error' => $e->getMessage(),
                'type' => 'business_error'
            ], $e->getStatusCode());
        });

        // 시스템 예외 처리 (프로덕션 환경)
        $exceptions->render(function (Exception $e, $request) {
            if (!app()->environment('local') && $request->expectsJson()) {
                return response()->json([
                    'error' => '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                    'type' => 'system_error'
                ], 500);
            }
        });
    })
    ->create();
```

# PhpStorm과 Checked Exception

PhpStorm을 기본 설정으로 사용하고 있다면, 직접 예외를 throw 하거나, 프레임워크나 라이브러리 내부에서 예외가 발생하는 로직을 호출했을 경우에 IDE에서 다음과 같은 경고가 뜨는 것을 본 적이 있을 것이다. ![](/images/1c7b8501-6f07-4c70-aac3-b20c0e8c1347-image.png)반대로, 어떤 예외들은 아래처럼 경고가 뜨지 않는다. 무슨 차이가 있는 걸까? ![](/images/65223c63-2d8d-4cbc-9053-409ee0fc2b80-image.png)

이것에 대해서는, IDE 설정에서 **확인되지 않은 예외**를 확인하면 된다. 여기에 등록되지 않은 예외들은 PhpStorm에서 [Checked Exception, 나머진 Unchekced Exception](https://www.baeldung.com/java-checked-unchecked-exceptions)으로 구분된다.
![](/images/7a88482c-294e-4d4c-96c3-b2ef76ed1828-image.png)

```php
namespace App\Exceptions;

use RuntimeException;

// 언체크드 예외를 상속한 클래스들은 언체크드 예외로 구분된다.
// 반대인 체크드 예외도 이처럼 구분된다.
class SomeException extends RuntimeException
{

}

```

PHP는 Java처럼 언어 차원에서 체크드 예외를 사용하지 않지만, PhpStrom이 이를 암묵적으로 구분하여 사용한다. 때문에, 체크드 예외를 직접 throw 하거나, 피호출부에서 처리되지 않았을 경우에 호출부에서 처리하도록 경고한다.

하지만, 나는 위에서 특별한 이유가 있지 않은 이상 예외를 상위로 전파한다고 하지 않았는가?
![](/images/285acfce-1c1b-4528-b0ec-eaaead56f53f-image.png) IDE에서 체크드 예외를 즉시 처리하지 않을 경우에 PhpDoc에 @thows 태그를 작성해 명시하는 것을 권장하는데, 이를 활용하면 된다. 아래처럼 IDE에서 경고가 떴을 때, 쉽게 주석 추가가 가능하다.

나는 이 IDE 기능을 활용해 비즈니스 예외를 전부 체크드 예외로 만들어, `Presentation Layer`까지 @throws 태그로 발생 가능한 비즈니스 예외들을 볼 수 있게 작성한다.

```php
namespace App\Exceptions;

use Exception;

// 많은 예제들이 비즈니스 예외를 RuntimeException을 상속 받는데,
// 나는 의도적으로 체크드 예외로 구분하기 위해 Exception 클래스를 상속 받는다.
class BusinessException extends Exception
{
]
```

```php
namespace App\Http\Controllers;

use App\Services\PurchaseService;
use App\Exceptions\PointInsufficientException;
use App\Exceptions\UserNotActiveException;
use Illuminate\Http\Request;

class PurchaseController
{
    private PurchaseService $purchaseService;

    public function __construct(PurchaseService $purchaseService)
    {
        $this->purchaseService = $purchaseService;
    }

    /**
     * @throws PointInsufficientException // Service에서 상위로 전파된 비즈니스 예외
     * @throws UserNotActiveException // 위와 동일
     */
    public function __invoke(Request $request)
    {
        $user = $request->user();
        $price = $request->input('price');

        // 서비스 호출, 예외 발생 가능
        $this->purchaseService->purchase($user, $price);

        return response()->json(['message' => '구매가 완료되었습니다.']);
    }
}
```

이렇게 사용하는 경우에 다음과 같은 이점들을 얻을 수 있다.

1. 실패 흐름을 명세화해서, 숨겨진 비즈니스 규칙을 드러냄
   - 비즈니스 로직은 예외를 통해 비즈니스 규칙을 표현하는 경우가 많음 (예: 포인트 부족, 쿠폰 만료, 이미 탈퇴한 회원 등)
   - 이런 예외를 @throws로 명시하면, 메서드가 어떤 상황에서 실패할 수 있는지를 외부에 명확하게 드러낼 수 있음
   - 즉, 예외 명세 자체가 비즈니스 요구사항 명세서 역할
2. 호출자에게 책임을 명확히 넘김 (명시적 처리 유도)
   - 호출자가 try-catch 없이 호출하면 PhpStorm이 경고를 띄움
   - 이는 무심코 예외를 흘려버리는 걸 방지하고, 호출자에게 "이 실패를 처리하든지, 전파하든지 해"라는 책임을 요구함
   - 개발자에게 "실패 가능성을 강제 인식"
3. 협업 시 코드 가독성/유지보수성 상승
   - 팀원이 봤을 때, @throws PointLackException 한 줄만 있어도 "아 이 메서드는 포인트 부족 가능성이 있구나" 라는 걸 즉시 이해할 수 있음
   - 내부 구현을 까보지 않아도 실패 조건을 빠르게 파악 가능
   - 메서드 변경 시, 명세된 예외 목록을 기준으로 영향 범위 파악도 쉬움
4. 테스트 설계와 예외 시나리오 검증에 도움
   - @throws가 명확히 있으면, 테스트할 때도 "이 예외가 언제 발생해야 하는가"를 명확히 설계 가능

> **🚨하지만, 이 처리 방식에는 한계가 있는데 다음과 같다.**

## 1. 런타임에서 동적으로 예외를 생성

아래처럼 코드를 작성하면 IDE에서 추론이 불가능하지만, 아래 같은 스타일은 안티 패턴이라고 생각해서 실전에서 사용해 본 적이 없는 방식이다.

```php
function throwExceptionDynamically(string $exceptionClass, string $message): void
{
    throw new $exceptionClass($message); // ← 여기서 어떤 예외가 던져질지 IDE가 추론 못함
}

// 호출부
throwExceptionDynamically(\RuntimeException::class, '뭔가 잘못됐음');
```

반대로, 아래처럼 작성하면 IDE에서 예외 추론이 가능하고, 실전에서도 자주 쓰이는 방식이다.

```php
/**
 * @throws \App\Exceptions\DomainException
 */
function throwMatchedException(string $type): void
{
    $exception = match ($type) {
        'runtime' => new \RuntimeException('런타임 예외'),
        'logic'   => new \LogicException('로직 예외'),
        'custom'  => new \App\Exceptions\DomainException('비즈니스 예외'), // IDE에서 추론 가능
        default   => throw new \InvalidArgumentException("Unknown type"),
    };

    throw $exception;
}

/**
 * @throws \App\Exceptions\DomainException // 호출부도 추론 가능
 */
throwMatchedException($type);
```

## 2. 콜백 내부에서 예외 발생

나는 `Service Layer`에서 중복되는 비즈니스 로직이 생기면, [Laravel Pipeline](https://medium.com/insiderengineering/understanding-laravel-pipelines-9717f5d58286)을 활용하여 `Pipe`라는 더 작은 단위로 비즈니스 로직 코드를 분리하는데, 이 때 `callable` 내부에서 던져지는 예외들은 IDE에서 추론을 못해 개발자가 직접 @throws 태그를 작성해야 한다.

```php
namespace App\Services;

use App\Pipes;
use App\Repositories\CommentRepository;
use Illuminate\Pipeline\Pipeline;

class CommentService
{
    protected $repository;
    protected $pipeline;

    public function __construct(CommentRepository $repository, Pipeline $pipeline)
    {
        $this->repository = $repository;
        $this->pipeline = $pipeline;
    }

    // 개발자가 추론해서 @throws 태그를 명시해야 하지만, 실수할 여지가 생김
    public function save(int $userId, string $message): Comment
    {
        return $this->pipeline
            ->send($message)
            ->through([
                // 개별 Pipe 안에서 비즈니스 예외가 발생해도 IDE가 추론 불가능
                Pipes\RemoveBadWords::class,
                Pipes\RemoveScripts::class,
                Pipes\GenerateLinks::class,
                // ...
            ])
            ->then(function (string $message) use ($userId) {
                return $this->repository->save([
                    'message' => $message,
                    'user_id' => $userId,
                ])
            });
    }
}
```

이 외에도 Laravel의 다양한 함수형 헬퍼들, 예를 들어 collection, tap, retry, rescue, pipe 등은 내부에서 콜백 기반으로 동작하기 때문에, 예외 흐름을 IDE가 정확히 추론하지 못하는 경우가 많다....

## 3. 프레임워크/라이브러리 내부 예외 처리

프레임워크나 라이브러리 내부에서 발생하는 예외들이 PhpStorm에 체크드 예외를 고려하고 작성되지 않기 때문에, 많은 경우에 아래처럼 `Throwable`이나 `Exception`을 처리하라는 경고가 뜰 것이다. (IDE에서 **확인되지 않은 예외**를 추가하는 것도 커스텀 예외보다 위에 2개를 던지는 경우가 많아서 불가능하다...)

```php
use Illuminate\Support\Facades\DB;
use App\Exceptions\PointLackException;
use App\Exceptions\CouponExpiredException;
use Throwable;

/**
 * @throws PointLackException
 * @throws CouponExpiredException
 * @throws Throwable // IDE 경고를 막기 위해 실제 비즈니스 로직과 관계없는 예외까지 명시함
 */
public function applyDiscountWithStrictSpec(int $userId): void
{
    DB::transaction(function () use ($userId) {
        $user = $this->userRepository->findById($userId);

        if ($user->point < 1000) {
            throw new PointLackException("포인트 부족");
        }

        if ($user->coupon->isExpired()) {
            throw new CouponExpiredException("쿠폰 만료");
        }

        $user->applyDiscount();
    });
}
```

위처럼 작성하면, 처음에 의도했던 비즈니스 요구사항 명세서 규칙이 깨지게 된다. 그래서 이를 지키기 위해 아래처럼 작성했던 시절도 있었다. 😅😅😅

```php
use Illuminate\Support\Facades\DB;
use App\Exceptions\PointLackException;
use App\Exceptions\CouponExpiredException;
use Throwable;

/**
 * @throws PointLackException
 * @throws CouponExpiredException
 */
public function applyDiscount(int $userId): void
{
    try {
        DB::transaction(function () use ($userId) {
            $user = $this->userRepository->findById($userId);

            if ($user->point < 1000) {
                throw new PointLackException("포인트 부족");
            }

            if ($user->coupon->isExpired()) {
                throw new CouponExpiredException("쿠폰 만료");
            }

            $user->applyDiscount();
        });
    } catch (Throwable $e) {
        // IDE 경고를 우회하기 위한 런타임 오버헤드 발생
        throw wrapException($e) // 비즈니스 예외는 그대로 다시 throw, 나머진 언체크드 예외로 래핑해서 throw
    }
}
```

현시점에선 이러한 문제들을 개선한 방법으로 [Psalm](https://github.com/vimeo/psalm) 툴을 사용하거나, [Result](https://github.com/GrahamCampbell/Result-Type)를 활용하여 코드를 재작성하는 방법이 있는데, 글이 너무 길어질 것 같아 다음 편에서 이어서 얘기하려고 한다.
