# Framework Selection Guide

## How to Use the Framework Parameter

The API supports both **React (Vite)** and **Next.js** scaffolds. By default, it uses Next.js.

### API Usage

**Next.js (Default):**
```bash
curl -X POST http://localhost:3000/chat/generate \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-nextjs-app",
    "prompt": "Create a landing page with hero section"
  }'
```

**React (Explicit):**
```bash
curl -X POST http://localhost:3000/chat/generate \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-react-app",
    "prompt": "Create a landing page with hero section",
    "framework": "react"
  }'
```

### Swagger UI

1. Navigate to http://localhost:3000/api
2. Expand `POST /chat/generate`
3. Click "Try it out"
4. Fill in the request body:
   ```json
   {
     "sessionId": "test-app",
     "prompt": "Create a dashboard",
     "framework": "react"
   }
   ```

### What You Get

**React Scaffold:**
- Vite + React 18
- React Router DOM
- 45+ shadcn/ui components
- TypeScript
- Tailwind CSS v3

**Next.js Scaffold:**
- Next.js 16 (App Router)
- 45+ shadcn/ui components
- TypeScript
- Tailwind CSS v3
- Turbopack

### Available Components (Both Scaffolds)

- **Forms**: button, input, textarea, select, checkbox, radio-group, label, form
- **Feedback**: alert, alert-dialog, toast, sonner, skeleton
- **Overlays**: dialog, sheet, drawer, popover, tooltip
- **Navigation**: tabs, accordion, dropdown-menu, navigation-menu
- **Data**: table, card, pagination, scroll-area
- **Display**: avatar, badge, separator, aspect-ratio
- **Interactive**: calendar, slider, switch, toggle, command

...and 20+ more!

See the full list in the scaffold directories:
- `templates/nextjs-scaffold/components/ui/`
- `templates/react-scaffold/src/components/ui/`
