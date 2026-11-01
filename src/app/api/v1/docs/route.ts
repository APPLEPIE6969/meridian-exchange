import { API_DOCS } from '@/lib/api/docs'
import { preflight } from '@/lib/api/respond'

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(API_DOCS, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export async function OPTIONS() {
  return preflight()
}
