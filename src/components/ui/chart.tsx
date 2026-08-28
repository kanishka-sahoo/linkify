'use client'

import * as React from 'react'
import * as RechartsPrimitive from 'recharts'
import { cn } from '~/lib/utils'

export type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode
    color?: string
  }
}

type ChartContextProps = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) throw new Error('useChart must be used within a <ChartContainer />')
  return context
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    config: ChartConfig
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
  }
>(({ className, children, config, style, ...props }, ref) => {
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        style={{
          ...Object.fromEntries(Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color])),
          ...style,
        }}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = 'Chart'

const ChartTooltip = RechartsPrimitive.Tooltip

interface TooltipPayloadItem {
  dataKey?: unknown
  name?: unknown
  value?: unknown
  color?: string
  payload?: { fill?: string }
}

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    active?: boolean
    payload?: TooltipPayloadItem[]
    label?: unknown
    labelFormatter?: (label: unknown, payload: unknown) => React.ReactNode
    hideLabel?: boolean
  }
>(({ active, payload, className, hideLabel = false, label, labelFormatter }, ref) => {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  return (
    <div ref={ref} className={cn('grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl', className)}>
      {!hideLabel && label != null && (
        <div className="font-medium">{labelFormatter ? labelFormatter(label, payload) : String(label)}</div>
      )}
      <div className="grid gap-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name)
          const itemConfig = config[key]
          return (
            <div key={key} className="flex w-full items-center gap-2">
              <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color ?? item.payload?.fill }} />
              <span className="text-muted-foreground">{itemConfig?.label ?? String(item.name ?? '')}</span>
              <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value ?? '')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
ChartTooltipContent.displayName = 'ChartTooltip'

export { ChartContainer, ChartTooltip, ChartTooltipContent }
