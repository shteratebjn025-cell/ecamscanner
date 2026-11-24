import { redirect } from 'next/navigation';

// Scanner is managed from the main page via useScanner hook
export default function ScannerPage() {
  redirect('/');
}
