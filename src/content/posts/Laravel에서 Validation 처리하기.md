---
title: 'Laravel에서 Validation 처리하기'
description: 'Laravel에서 Validation 처리를 어떻게 하면 좋을까?'
pubDate: 'May 21 2025'
tags: ['laravel', 'php', 'validation']
---

이전에 작성한 [Laravel HTTP Request를 DTO로 만들기](/laravel-http-request를-dto로-만들기)를 먼저 참고해 주세요.

## Laravel FormRequest

Laravel에서 일반적인 Validation 처리 가이드는 `Illuminate\Foundation\Http\FormRequest` 클래스 기반으로, 꽤나 Controller에 의존적인 예제로 알려준다.

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];
    }
}
```

작은 규모의 프로젝트에서 FormRequest는 꽤나 만능처럼 보인다, 하지만 서비스가 점차 커짐에 따라 Controller 이외에 다른 진입점(Artisan Command, Job, Listener)에서 Service를 호출하기 시작하면 문제가 발생하기 시작한다.

```php
// Anywhere
dispatch(new RegisterUserJob([
    'name' => '   bad name   ',
    'email' => 'bad@@example.com',
    'password' => '123'
]));
```

Controller 이외에 진입점은 보통 일반 사용자가 input 값을 입력하지 않는 영역이지만, 잘못된 데이터가 Service로 들어올 위험이 생겼다는 걸 참을 수 없다. 무엇보다 나는 나를 믿지 못하기 때문에 Service Layer로 들어오는 값에 대한 Validation 요구사항이 생겼다.

추가로 FormRequest에서 쿼리를 날리는 규칙들은 정말로 unique가 필요하거나 순서 처리가 필요한 상황에서 [race condition](https://velog.io/@yarogono/CS-Race-condition%EC%9D%B4%EB%9E%80)이 발생할 수 있어, 이를 비즈니스 로직으로 보고 Service Layer에서 Validation 처리를 하려고 한다.

## Validation 성격 나누기

나의 경우, Validation을 보통 아래 2가지로 나누어 바라본다.

| 항목      | **Application Validation**                 | **Business Validation**               |
| --------- | ------------------------------------------ | ------------------------------------- |
| **언제?** | 유저 입력 시점                             | 도메인 로직 실행 시점                 |
| **목적**  | 형식, 존재 여부, 기본 제약 확인            | 도메인 규칙과 상태 일관성 확인        |
| **예시**  | 이메일 형식 확인, 필수값 체크, 문자열 길이 | "회원은 같은 이메일로 가입할 수 없음" |

처음 예시였던 RegisterRequest 같은 경우, email 필드에 `unique:users` 같은 경우가 Business Validation, 나머지 규칙들이 Application Validation으로 볼 수 있다.

보통 Business Validation 같은 경우에 Service Layer 영역에서 작성하고, Application Validation 같은 경우엔 어디에서든 검증할 수 있지만 ` spatie/laravel-data` 패키지를 사용하면 DTO 생성 시점에 확인이 가능하다.

```text
         +----------------------+
         | HTTP Request         |
         | (FormRequest)        |
         +----------+-----------+
                    |
        (Optional)  |  (FormRequest: 1차 검사)
                    ▼
         +----------------------+
         | DTO / Data Object    | ← 최소 정제, 필터, 기본 유효성
         +----------+-----------+
                    |
                    ▼
         +----------------------+
         | Service Layer        | ← 비즈니스 검증, DB 접근
         +----------------------+

모든 진입점 (Job, Command, Controller 등) → DTO → Service
```

이를 코드로 구현하면 다음과 같다.

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // 비밀번호 확인은 유저측에서만 확인이 필요해서 여기서 처리
            'password' => ['confirmed'],
        ];
    }
}

```

```php
<?php

namespace App\DTOs;

use App\DTOs\Transformers\TrimStringTransformer;
use Spatie\LaravelData\Attributes\Validation\Email;
use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Attributes\Validation\Required;
use Spatie\LaravelData\Attributes\Validation\StringType;
use Spatie\LaravelData\Attributes\WithTransformer;
use Spatie\LaravelData\Data;

final class RegisterUserData extends Data
{
    public function __construct(
        // Application Validation
        #[Required, StringType, Max(255)]
        // Sanitize 처리도 가능하다.
        #[WithTransformer(TrimStringTransformer::class)]
        readonly public string $name,
        #[Required, StringType, Email, Max(255)]
        #[WithTransformer(TrimStringTransformer::class)]
        readonly public string $email,
        #[Required, StringType, Min(8)]
        #[WithTransformer(TrimStringTransformer::class)]
        readonly public string $password
    ) {}
}
```

```php
<?php

namespace App\Services;

use App\DTOs\RegisterUserData;
use App\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Throwable;

class RegisterUserService
{
    /**
     * @throws Throwable
     */
    public function handle(RegisterUserData $data): User
    {
        return DB::transaction(function () use ($data) {
            // Business Validation Rule
            if (User::where('email', $data->email)->exists()) {
                throw new DomainException("Email already exists.");
            }

            return User::create([
                'name' => $data->name,
                'email' => $data->email,
                'password' => Hash::make($data->password),
            ]);
        });
    }
}
```

```php
<?php

namespace App\Jobs;

use App\DTOs\RegisterUserData;
use App\Models\User;
use App\Services\RegisterUserService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class RegisterUserJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private readonly RegisterUserData $userData
    ) {}

    /**
     * @throws Throwable
     */
    public function handle(RegisterUserService $registerUserService): User
    {
        return $registerUserService->handle($this->userData);
    }
}
```

이와 같이 구현하면 Contoller 같은 상위 Layer에서 Service를 호출하는 케이스마다 같은 Validation 규칙 검사 코드를 작성하는 중복이 발생하지 않는다. 또한, Service에선 DTO 값을 항상 신뢰할 수 있으며 비즈니스 로직에만 집중할 수 있다.

## [Value Object](https://en.wikipedia.org/wiki/Value_object)를 활용하기

여기서 의문이 하나 생긴다. Service 내부에 입력 값이 DTO를 통해 검증되었으니, Model에 해당하는 Laravel Eloquent에 필드값들이 항상 검증됐는지 보장할 수 있는 것일까?

물론, 당연히 아니다. Service와 Model 중간의 [Repository](https://en.wikipedia.org/wiki/Content_repository) Layer를 만들어 값을 한 번 더 검증한다고 해도 Eloquent를 CLI 커맨드, 테스트 코드, 마이그레이션 등에서 직접 호출하는 경우가 빈번히 발생하게 된다.

Usecase가 적을 땐 개발자가 조금 더 신경 쓰면 된다지만, 프로젝트 규모가 커질수록 실수하기 쉬워진다. 이를 VO를 통해 해결해보자.

```php
<?php

namespace App\ValueObjects;

use InvalidArgumentException;

final readonly class Email
{
    public function __construct(private string $value)
    {
        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException("Invalid email format: {$value}");
        }
    }

    public function value(): string
    {
        return $this->value;
    }

    public function equals(Email $other): bool
    {
        return $this->value === $other->value();
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
```

```php
<?php

namespace App\Models\Casts;

use App\ValueObjects\Email;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;

class EmailCast implements CastsAttributes
{
    public function get($model, string $key, $value, array $attributes): Email
    {
        return new Email($value);
    }

    public function set($model, string $key, $value, array $attributes): string
    {
        if ($value instanceof Email) {
            return $value->value();
        }

        return (new Email($value))->value();
    }
}
```

```php
...
    // in User
    protected $casts = [
        'email' => EmailCast::class,
    ];
...
```

Eloquent에서 제공하는 Casting 기능을 통해 email 필드를 항상 Email VO를 통해 접근하도록 변경하였다. 이를 통해, 혹시 모를 실수가 발생해도 개발자가 빠르게 캐치할 수 있다.

### 📌 각각의 책임 구분

| 레이어                                     | 검증 목적                                    | 예시                                                | 실패 시 처리 방식                         |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| **Cotroller(Entry Point) <-> Service DTO** | 사용자 입력에 대한 **UX 수준의 피드백** 제공 | `"이메일 필드가 비어있어요"`, `"형식이 잘못됐어요"` | ValidationException 등 사용자 친화적 응답 |
| **Value Object**                           | **비즈니스 규칙 일관성 보장**                | `"이건 비즈니스 규칙상 유효한 이메일이 아님"`       | 예외(Exception)로 막음 — 시스템 보호      |

하지만, 위 예시에선 Email Validation에 대한 코드 관리가 분산되어 [SSOT](https://en.wikipedia.org/wiki/Single_source_of_truth)가 무너졌다. VO에서도 검증이 필요한 필드들은 한 곳에서만 규칙을 작성하여 여러 계층에서 검증할 수 있게 수정해보자.

```php
<?php

namespace App\ValueObjects;

use InvalidArgumentException;

final readonly class Email
{
    public function __construct(private string $value)
    {
        self::assert($value);
    }

    public static function isValid(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
    }

    // 만약, 특정 도메인만 필터한다는 요구사항이 생긴다면 여기서 한 번만 수정하면 된다.
    public static function assert(string $value): void
    {
        if (!self::isValid($value)) {
            throw new InvalidArgumentException("Invalid email format: $value");
        }
    }

    public function value(): string
    {
        return $this->value;
    }

    public function equals(Email $other): bool
    {
        return $this->value === $other->value();
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
```

```php
<?php

namespace App\Rules;

use App\ValueObjects\Email;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class EmailRule implements ValidationRule
{
    public function passes($attribute, $value): bool
    {
        return Email::isValid($value);
    }

    public function message(): string
    {
        return __('validation.email');
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (!Email::isValid($value)) {
            $fail(__('validation.email'));
        }
    }
}
```

```php
...
        // in RegisterUserData
        #[Required, StringType, Max(255)]
        #[Rule(EmailRule::class)]
        #[WithTransformer(TrimStringTransformer::class)]
        readonly public string $email,
...

```

이렇게 하면 추후에 Email 검증 규칙 변경이 필요할 때, 해당 클래스만 수정하면 끝이라 변경사항도 적고 실수할 여지가 줄어든다.

또한, VO를 POPO로 유지, Application Layer는 Laravel 친화적인 방식으로 구성하여 추후에 [DDD](https://ko.wikipedia.org/wiki/%EB%8F%84%EB%A9%94%EC%9D%B8_%EC%A3%BC%EB%8F%84_%EC%84%A4%EA%B3%84)로 구성하기에도 용이하다.
