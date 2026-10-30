export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(
    {
      authRequired: !!process.env.INTERNAL_ACCESS_TOKEN,
      configured: !!process.env.BITBUCKET_TOKEN,
      productionNeedsKey:
        process.env.NODE_ENV === 'production' && !process.env.INTERNAL_ACCESS_TOKEN,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
