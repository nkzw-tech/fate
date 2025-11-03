import Stack from '@nkzw/stack';
import { ChevronLeft, CircuitBoard, LogIn, LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import AuthClient from '../user/AuthClient.tsx';
import { Button } from './Button.tsx';
import Link from './Link.tsx';

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: session, isPending } = AuthClient.useSession();

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-50 border-b backdrop-blur">
      <Stack
        alignCenter
        between
        className="relative container mx-auto h-11"
        gap={16}
        horizontalPadding
        verticalPadding={4}
      >
        <Link
          onClick={() =>
            pathname !== '/' && history.state?.idx > 0
              ? navigate(-1)
              : navigate('/')
          }
          to="/"
        >
          <div className="flex items-center space-x-2">
            <div className="relative">
              {pathname === '/' ? (
                <CircuitBoard className="h-6 w-6 text-gray-500" />
              ) : (
                <ChevronLeft className="h-6 w-6 text-gray-500" />
              )}
            </div>
            <span className="bg-linear-to-r from-gray-500 to-gray-900 bg-clip-text text-xl font-bold text-transparent dark:to-gray-200">
              Fate Demo
            </span>
          </div>
        </Link>
        <Stack alignCenter gap>
          {session ? (
            <>
              <Button asChild size="sm" variant="ghost">
                <a
                  className="flex items-center hover:text-gray-600"
                  onClick={() => AuthClient.signOut()}
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Logout</span>
                </a>
              </Button>
            </>
          ) : !isPending ? (
            <Button asChild size="sm" variant="ghost">
              <Link to="/login">
                <LogIn className="h-4 w-4" /> Login
              </Link>
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </header>
  );
}
