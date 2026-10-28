import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import typography from '@tailwindcss/typography'

// Helper: colore HSL da variabile CSS con supporto all'opacità (bg-primary/10 ecc.)
const c = (name: string) => `hsl(var(--${name}) / <alpha-value>)`

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: {
          DEFAULT: c('border'),
          strong: c('border-strong'),
        },
        input: c('input'),
        ring: c('ring'),
        background: c('background'),
        foreground: c('foreground'),
        primary: {
          DEFAULT: c('primary'),
          foreground: c('primary-foreground'),
        },
        secondary: {
          DEFAULT: c('secondary'),
          foreground: c('secondary-foreground'),
        },
        muted: {
          DEFAULT: c('muted'),
          foreground: c('muted-foreground'),
        },
        accent: {
          DEFAULT: c('accent'),
          foreground: c('accent-foreground'),
        },
        destructive: {
          DEFAULT: c('destructive'),
          foreground: c('destructive-foreground'),
          subtle: c('destructive-subtle'),
        },
        success: {
          DEFAULT: c('success'),
          foreground: c('success-foreground'),
          subtle: c('success-subtle'),
        },
        warning: {
          DEFAULT: c('warning'),
          foreground: c('warning-foreground'),
          subtle: c('warning-subtle'),
        },
        info: {
          DEFAULT: c('info'),
          foreground: c('info-foreground'),
          subtle: c('info-subtle'),
        },
        card: {
          DEFAULT: c('card'),
          foreground: c('card-foreground'),
        },
        popover: {
          DEFAULT: c('popover'),
          foreground: c('popover-foreground'),
        },
        'surface-2': c('surface-2'),
        elevated: c('elevated'),
        sidebar: {
          DEFAULT: c('sidebar'),
          foreground: c('sidebar-foreground'),
          border: c('sidebar-border'),
          accent: c('sidebar-accent'),
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 2px)', // 12px: dialog, card grandi
        lg: 'var(--radius)', // 10px: card
        md: 'calc(var(--radius) - 2px)', // 8px: controlli
        sm: 'calc(var(--radius) - 4px)', // 6px: chip, item di menu
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-lg)',
      },
      zIndex: {
        sticky: '20',
        header: '30',
        overlay: '40',
        modal: '50',
        popover: '60',
        toast: '100',
        tooltip: '110',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px: meta/contatori
        caption: ['0.75rem', { lineHeight: '1rem' }], // 12px
        body: ['0.875rem', { lineHeight: '1.25rem' }], // 14px
        heading: ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.006em', fontWeight: '600' }], // 16px
        title: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.014em', fontWeight: '600' }], // 22px
        display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.022em', fontWeight: '600' }], // 30px
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'hsl(var(--foreground))',
            '--tw-prose-headings': 'hsl(var(--foreground))',
            '--tw-prose-lead': 'hsl(var(--muted-foreground))',
            '--tw-prose-links': 'hsl(var(--primary))',
            '--tw-prose-bold': 'hsl(var(--foreground))',
            '--tw-prose-counters': 'hsl(var(--muted-foreground))',
            '--tw-prose-bullets': 'hsl(var(--muted-foreground) / 0.6)',
            '--tw-prose-hr': 'hsl(var(--border))',
            '--tw-prose-quotes': 'hsl(var(--muted-foreground))',
            '--tw-prose-quote-borders': 'hsl(var(--border-strong))',
            '--tw-prose-captions': 'hsl(var(--muted-foreground))',
            '--tw-prose-kbd': 'hsl(var(--foreground))',
            '--tw-prose-kbd-shadows': 'var(--border)',
            '--tw-prose-code': 'hsl(var(--foreground))',
            '--tw-prose-pre-code': 'hsl(var(--foreground))',
            '--tw-prose-pre-bg': 'hsl(var(--surface-2))',
            '--tw-prose-th-borders': 'hsl(var(--border))',
            '--tw-prose-td-borders': 'hsl(var(--border))',
            // I token cambiano già col tema: prose-invert usa gli stessi valori.
            '--tw-prose-invert-body': 'hsl(var(--foreground))',
            '--tw-prose-invert-headings': 'hsl(var(--foreground))',
            '--tw-prose-invert-lead': 'hsl(var(--muted-foreground))',
            '--tw-prose-invert-links': 'hsl(var(--primary))',
            '--tw-prose-invert-bold': 'hsl(var(--foreground))',
            '--tw-prose-invert-counters': 'hsl(var(--muted-foreground))',
            '--tw-prose-invert-bullets': 'hsl(var(--muted-foreground) / 0.6)',
            '--tw-prose-invert-hr': 'hsl(var(--border))',
            '--tw-prose-invert-quotes': 'hsl(var(--muted-foreground))',
            '--tw-prose-invert-quote-borders': 'hsl(var(--border-strong))',
            '--tw-prose-invert-captions': 'hsl(var(--muted-foreground))',
            '--tw-prose-invert-kbd': 'hsl(var(--foreground))',
            '--tw-prose-invert-kbd-shadows': 'var(--border)',
            '--tw-prose-invert-code': 'hsl(var(--foreground))',
            '--tw-prose-invert-pre-code': 'hsl(var(--foreground))',
            '--tw-prose-invert-pre-bg': 'hsl(var(--surface-2))',
            '--tw-prose-invert-th-borders': 'hsl(var(--border))',
            '--tw-prose-invert-td-borders': 'hsl(var(--border))',
            a: {
              fontWeight: '500',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              textDecorationColor: 'hsl(var(--primary) / 0.4)',
            },
            'a:hover': { textDecorationColor: 'hsl(var(--primary))' },
            code: {
              fontWeight: '500',
              backgroundColor: 'hsl(var(--muted))',
              borderRadius: '0.25rem',
              padding: '0.125rem 0.3rem',
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            pre: {
              border: '1px solid hsl(var(--border))',
              borderRadius: 'calc(var(--radius) - 2px)',
            },
            'pre code': { backgroundColor: 'transparent', padding: '0' },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },
            blockquote: { fontStyle: 'normal', fontWeight: '400' },
          },
        },
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config
