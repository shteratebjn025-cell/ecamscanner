import { type ReactNode } from 'react';
import BottomNav from './BottomNav';

interface AppShellProps {
  children: ReactNode;
  hideNav?: boolean;
}

export default function AppShell({ children, hideNav = false }: AppShellProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className={`flex-1 ${hideNav ? '' : 'pb-16'}`}>{children}</main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
