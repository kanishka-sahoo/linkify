import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '~/components/ui/button'

type Theme = 'light' | 'dark' | 'system'

function getStored(): Theme {
  return (localStorage.getItem('theme') as Theme) || 'system'
}

function apply(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  return dark
}

export function ThemeToggle() {
  // Unknown during SSR (the theme lives in localStorage), so it's read after mount.
  const [isDark, setIsDark] = useState<boolean | null>(null)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStored() === 'system') setIsDark(apply('system'))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function toggle() {
    const next: Theme = isDark ? 'light' : 'dark'
    localStorage.setItem('theme', next)
    setIsDark(apply(next))
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} title="Toggle dark mode" aria-label="Toggle dark mode">
      {isDark === null ? <span className="size-4" /> : isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

/** Inline script that applies the stored theme before first paint (no FOUC). */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`
