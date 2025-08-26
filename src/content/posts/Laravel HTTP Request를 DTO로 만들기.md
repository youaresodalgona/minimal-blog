---
title: 'Laravel HTTP Request를 DTO로 만들기'
description: 'Laravel에서 DTO 사용하기'
pubDate: 'May 20 2025'
tags: ['DTO', 'laravel', 'php']
---

## DTO를 왜 만드는가?

```text
# Laravel MVCS 구조 다이어그램

사용자 요청 (HTTP Request)
        │
        ▼
   [ Routes (web.php / api.php) ]
        │
        ▼
   [ Controller (App\Http\Controllers) ]
        │
        ▼
   [ Service Layer (App\Services) ]
        │
        ▼
   [ Model (App\Models) ]
        │
        ▼
   [ Database (MySQL, PostgreSQL 등) ]

        ▲
        │
   [ View (Blade Template - resources/views) ]
        │
        └── Controller를 통해 데이터 전달 후 사용자에게 출력 (HTTP Response)
```

많이들 라라벨에서 [MVCS](https://pvha.hashnode.dev/mvcs-architecture) 구조로 프로젝트를 작성하고 있을텐데, 현업에서도 이런 코드들을 심심치 않게 볼 수 있다.

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterRequest;
use App\Services\RegisterUserService;
use Throwable;

class RegisterController extends Controller
{
    /**
     * @throws Throwable
     */
    public function register(RegisterUserService $service, RegisterRequest $request)
    {
        $user = $service->handle($request);

        auth()->login($user);

        return redirect()->route('dashboard');
    }
}
```

```php
<?php

namespace App\Services;

use App\Http\Requests\RegisterRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use InvalidArgumentException;
use Throwable;

class RegisterUserService
{
    /**
     * @throws Throwable
     */
    public function handle(RegisterRequest $request): User
    {
        if (!$request->validated()) {
            throw new InvalidArgumentException("Validation failed.");
        }

        return DB::transaction(function () use ($request) {
            return User::create([
                'name' => $request->input('name'),
                'email' => $request->input('email'),
                'password' => Hash::make($request->input('password')),
            ]);
        });
    }
}
```

Service Layer(Application)는 비즈니스 로직을 모아 재사용성과 유지보수성을 높이는 곳으로, 진입점으로 Controller 이외에 Artisan Command, Job, Listener에서도 사용이 가능해야 한다.

하지만, 예시에선 Service에서 Laravel Rquest 객체를 인자로 받아 [의존성 누수](https://en.wikipedia.org/wiki/Leaky_abstraction)가 생긴데다, Laravel Request validation은 Controller Layer의 책임으로 [SRP](https://en.wikipedia.org/wiki/Single-responsibility_principle) 마저 위반했다. Service Layer는 오직 비즈니스 로직만 담당해야 한다.

## 그냥 배열로 넘기면 되는 것 아닌가?

```php
...
    // in App\Http\Controllers\Auth\RegisterController
    public function register(RegisterUserService $service, RegisterRequest $request)
    {
        $user = $service->handle($request->all()));

        auth()->login($user);

        return redirect()->route('dashboard');
    }
...
```

쉽게 이런 유혹에 빠지기 쉽지만, 이 방식은 어떤 필드가 들어오는지 명시적이지 않아 데이터 구조 변경 시 의도치 않은 사이드 이펙트나, 오류가 런타임까지 감춰질 수 있어 안정성이 떨어진다.

이는 경험자 입장에서 만든 사람도 그렇지만, 해당 코드를 처음 보는 사람은 더더욱 유지보수 하기 어려운 코드이기에 프로젝트가 커질수록 DTO 사용을 권장한다.

## DTO 작성하기

위 문제들을 해결하기 위해 다음과 같이 [DTO](https://en.wikipedia.org/wiki/Data_transfer_object)를 작성하면 된다.

```php
<?php

namespace App\DTOs;

class RegisterUserData
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password
    ) {}
}
```

```php
...
	// in App\Http\Requests\RegisterRequest
    public function toDto(): RegisterUserData
    {
        return new RegisterUserData(
            name: $this->input('name'),
            email: $this->input('email'),
            password: $this->input('password'),
        );
    }
...
```

```php
...
	// in App\Services\RegisterUserService
    public function handle(RegisterUserData $data): User
    {
        return DB::transaction(function () use ($data) {
            return User::create([
                'name' => $data->name,
                'email' => $data->email,
                'password' => Hash::make($data->password),
            ]);
        });
    }
...
```

순수 [POPO](https://en.wikipedia.org/wiki/Plain_old_Java_object)로 작성한 DTO로 인하여, RegisterUserService에서 자신을 호출하는 상위 Layer에 존재를 알 필요가 없어졌다.

이로 인해 Artisan Command, Job, Listener에서도 유저를 생성하게 될 경우, 똑같이 RegisterUserService를 호출하면 된다.

이 방식의 단점으로는 상위 Layer에서 DTO로 변환하는 필드가 많을 때 코드 작성이 매우 번거로웠지만(~~Spring에선 딸깍인데~~), 요즘은 AI 도구의 도움으로 빠르게 작성이 가능해서 약간의 귀찮음만 감수하면 된다.

이 마저도 귀찮다면, [`spatie/laravel-data`](https://github.com/spatie/laravel-data)를 사용하자.

```php
<?php

namespace App\DTOs;

use Spatie\LaravelData\Data;

class RegisterUserData extends Data
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password
    ) {}
}
```

```php
...
    // in App\Http\Controllers\Auth\RegisterController
    public function register(RegisterUserService $service, RegisterRequest $request)
    {
        $user = $service->handle(RegisterUserData::from($request));

        auth()->login($user);

        return redirect()->route('dashboard');
    }
...
```

`DTO::from($laravelRequest)` 이런 식으로 작성하면 `$laravelRequest->toDto()` 메서드를 내가 직접 구현하지 않아도 된다. 대신, Service Layer가 해당 라이브러리와 의존성이 생기지만 아예 언어를 바꾸지 않는 이상 개발 편의성을 위해 때로는 현실과 타협을 하는 게 이로울 때도 있다!

DTO 필드를 Public으로 선언하는 것에 대해서도 많은 [논쟁](https://www.reddit.com/r/PHP/comments/kkrzks/getterssetters_vs_public_properties/)이 있지만, 나는 DTO에 getter/setter는 너무 장황하다는 주의다. 혹시 모를 실수를 없애고 싶다면 아래처럼 readonly class로 만드는 것이 좋다.

```php
<?php

namespace App\DTOs;

use App\Http\Requests\RegisterRequest;
use Spatie\LaravelData\Data;

// 상속 받은 Data 클래스가 readonly class가 아니기 때문에 필드에 선언해야 함.
final class RegisterUserData extends Data
{
    public function __construct(
        readonly public string $name,
        readonly public string $email,
        readonly public string $password
    ) {}
}
```

## 마치며

라라벨의 수 많은 매직들은 빠른 개발에 많은 도움이 되지만, 프로젝트가 점차 커지다 보면 쉽게 유지보수 하기 어려운 길로 빠지게 된다. 이를 주의하며 개발하자!

그리고 예시를 잘 보신 분들이라면, "Controller가 아닌 곳에서 RegisterUserService를 호출하면 Validation은 어떻게 하려고?" 이런 의문이 들었을 것 이다. 다음엔 **"Validation은 어디에서 해야 하는가?"** 라는 주제로 글을 써보려고 한다.
