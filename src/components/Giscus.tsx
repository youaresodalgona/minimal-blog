import { useEffect } from 'react'

interface GiscusProps {
  repo: string
  repoId: string
  category: string
  categoryId: string
  mapping?: string
  term?: string
  strict?: boolean
  reactionsEnabled?: boolean
  emitMetadata?: boolean
  inputPosition?: 'top' | 'bottom'
  theme?: string
  lang?: string
}

export default function Giscus({
  repo,
  repoId,
  category,
  categoryId,
  mapping = 'pathname',
  term = '',
  strict = false,
  reactionsEnabled = true,
  emitMetadata = false,
  inputPosition = 'bottom',
  theme = 'preferred_color_scheme',
  lang = 'ko'
}: GiscusProps) {
  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://giscus.app/client.js'
    script.setAttribute('data-repo', repo)
    script.setAttribute('data-repo-id', repoId)
    script.setAttribute('data-category', category)
    script.setAttribute('data-category-id', categoryId)
    script.setAttribute('data-mapping', mapping)
    if (term) script.setAttribute('data-term', term)
    script.setAttribute('data-strict', strict ? '1' : '0')
    script.setAttribute('data-reactions-enabled', reactionsEnabled ? '1' : '0')
    script.setAttribute('data-emit-metadata', emitMetadata ? '1' : '0')
    script.setAttribute('data-input-position', inputPosition)
    script.setAttribute('data-theme', theme)
    script.setAttribute('data-lang', lang)
    script.setAttribute('data-loading', 'lazy')
    script.crossOrigin = 'anonymous'
    script.async = true

    const giscusContainer = document.getElementById('giscus-container')
    if (giscusContainer) {
      giscusContainer.appendChild(script)
    }

    return () => {
      const giscusFrame = document.querySelector('iframe.giscus-frame')
      if (giscusFrame) {
        giscusFrame.remove()
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [
    repo,
    repoId,
    category,
    categoryId,
    mapping,
    term,
    strict,
    reactionsEnabled,
    emitMetadata,
    inputPosition,
    theme,
    lang
  ])

  return <div id="giscus-container"></div>
}
