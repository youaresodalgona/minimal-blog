import type { ThemeObjectOrShikiThemeName } from 'astro-expressive-code'

type Config = {
  author: string
  title: string
  description: string
  lang: string
  themes: {
    dark: ThemeObjectOrShikiThemeName
    light: ThemeObjectOrShikiThemeName
  }
}

export default {
  author: 'YouAreSoDalgona',
  title: 'YouAreSoDalgona 개발 블로그',
  description: 'YouAreSoDalgona님이 작성한 포스트 시리즈들을 확인해보세요.',
  lang: 'ko',
  themes: {
    dark: 'github-dark',
    light: 'github-light'
  }
} satisfies Config
