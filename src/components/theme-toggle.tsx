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
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const t = getStored()
    setTheme(t)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStored() === 'system') apply('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')

  function toggle() {
    const next: Theme = isDark ? 'light' : 'dark'
    localStorage.setItem('theme', next)
    setTheme(next)
    apply(next)
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} title="Toggle dark mode">
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}

/** Inline script that applies the stored theme before first paint (no FOUC). */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`
