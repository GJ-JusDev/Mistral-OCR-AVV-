import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * NEXT.JS MIDDLEWARE (AUTHENTICATION & RBAC ROUTE GUARD)
 *
 * Bakit ito napakahalaga sa Defense:
 * Ito ang unang humaharang sa bawat incoming request bago pa man mag-render ang page:
 * 1. Session & Cookie Refresh:
 *    - Pinapanatiling aktibo ang Supabase session cookies ng user.
 * 2. Unauthenticated Guard:
 *    - Kapag hindi naka-login ang user, kusa silang ire-redirect papuntang `/login`.
 * 3. Authoritative Role-Based Access Control (RBAC):
 *    - Kinukuha ang role direkta sa `user_roles` database table (hindi lang sa cookie o metadata)
 *      para hindi mapalsipika o ma-bypass.
 * 4. Principal Isolation:
 *    - Dahil monitoring-only ang School Head / Principal, binablock ang access nila sa `/upload`
 *      at `/review` upang mapanatili ang separation of duties (ang mga guro ang nag-e-encode).
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // I-initialize ang Supabase client gamit ang request cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register');
  const isPublicRoute = pathname === '/' || pathname.startsWith('/landing') || pathname.startsWith('/terms') || isAuthRoute;
  
  // 1. Kung walang active session at hindi public page, pabalikin sa /login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 2. Kung naka-login na pero pumunta sa /login o /register, dalhin sa dashboard kung Approved lamang
  if (user && isAuthRoute) {
    if (request.nextUrl.searchParams.get('registered') === 'pending') {
      return supabaseResponse;
    }

    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('account_status')
      .eq('user_id', user.id)
      .maybeSingle();

    const isApproved = roleRow?.account_status === 'Approved' || user.user_metadata?.account_status === 'Approved';
    if (isApproved) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  // 3. Authoritative role and status check para sa mga protected routes
  if (user) {
    const needsRoleCheck = 
      pathname.startsWith('/admin') || 
      pathname.startsWith('/principal') || 
      pathname.startsWith('/upload') || 
      pathname.startsWith('/review') ||
      pathname.startsWith('/documents') ||
      pathname.startsWith('/students') ||
      pathname.startsWith('/settings');

    if (needsRoleCheck) {
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('role, account_status')
        .eq('user_id', user.id)
        .maybeSingle();

      const role = roleRow?.role?.toLowerCase() || '';
      const isApproved = roleRow?.account_status === 'Approved';

      // 3.0 Proteksyon para sa hindi pa approved (Pending o Declined): ibalik sa '/'
      if (!isApproved) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        return NextResponse.redirect(url);
      }

      // 3.1 Proteksyon sa Admin routes: Approved Admin lamang ang pwedeng pumasok
      if (pathname.startsWith('/admin')) {
        if (!isApproved || role !== 'admin') {
          const url = request.nextUrl.clone();
          url.pathname = '/';
          return NextResponse.redirect(url);
        }
      }

      // 3.2 Proteksyon sa Principal routes: Approved Principal at Admin lamang
      if (pathname.startsWith('/principal')) {
        if (!isApproved || (role !== 'principal' && role !== 'admin')) {
          const url = request.nextUrl.clone();
          url.pathname = '/';
          return NextResponse.redirect(url);
        }
      }

      // 3.3 Principal accounts are monitoring-only:
      // Mahigpit na binablock ang Principal sa /upload at /review para maiwasan ang self-encoding
      if (role === 'principal' && (pathname.startsWith('/upload') || pathname.startsWith('/review'))) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
