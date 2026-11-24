'use client';
import { useRef, useState, useEffect } from 'react';
import { Camera, Upload, ScanLine, FileText, Zap, Shield, ChevronRight, X } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import RecentDocuments from '@/components/dashboard/RecentDocuments';
import CameraView from '@/components/scanner/CameraView';
import CropEditor from '@/components/scanner/CropEditor';
import ImageEditor from '@/components/scanner/ImageEditor';
import PageManager from '@/components/scanner/PageManager';
import ExportModal from '@/components/scanner/ExportModal';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useScanner } from '@/hooks/useScanner';
import type { DocumentRecord } from '@/types';

export default function ScannerApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    state,
    setStep,
    clearError,
    loadPages,
    handleImageAcquired,
    handleCropConfirmed,
    handlePageSaved,
    handleDeletePage,
    handleReorderPage,
    handleEditPage,
    handleAddPage,
    handleSaveDocument,
    handleGalleryFiles,
    reset,
    updateDocumentName,
  } = useScanner();

  const [showExport, setShowExport] = useState(false);
  const [reopenDoc, setReopenDoc]   = useState<DocumentRecord | null>(null);
  const [sourceModal, setSourceModal] = useState(false);

  // Auto-dismiss errors after 4 seconds
  useEffect(() => {
    if (!state.error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [state.error, clearError]);

  function handleScanButton() {
    if (state.pages.length > 0) {
      setStep('pages');
    } else {
      setSourceModal(true);
    }
  }

  function handleSelectCamera() {
    setSourceModal(false);
    setStep('camera');
  }

  function handleSelectGallery() {
    setSourceModal(false);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleGalleryFiles(files);
    }
    e.target.value = '';
  }

  function handleOpenDoc(doc: DocumentRecord) {
    loadPages(doc.pages, doc.name);
    setReopenDoc(null);
    setShowExport(true);
  }

  function handleExportClose() {
    setShowExport(false);
  }

  function handleExportDone() {
    setShowExport(false);
    reset();
  }

  // ─── Hidden file input — always present ─────────────────────────────────
  const fileInputEl = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/jpg,image/png,image/webp"
      className="hidden"
      onChange={handleFileChange}
    />
  );

  // ─── Global overlays ─────────────────────────────────────────────────────
  const globalOverlays = (
    <>
      {state.processing && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center gap-3 shadow-xl mx-6">
            <LoadingSpinner size="lg" />
            <p className="text-gray-700 font-medium text-sm">Memproses gambar...</p>
          </div>
        </div>
      )}
      {state.error && (
        <div className="fixed top-4 left-4 right-4 z-[70] max-w-md mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 shadow-lg flex items-start gap-2">
            <p className="text-red-700 text-sm flex-1">{state.error}</p>
            <button onClick={clearError} className="text-red-400 hover:text-red-600 mt-0.5">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );

  // ─── Scanner step render branches ────────────────────────────────────────

  if (state.step === 'camera') {
    return (
      <>
        {fileInputEl}
        {globalOverlays}
        <CameraView
          onCapture={handleImageAcquired}
          onClose={() => setStep(state.pages.length > 0 ? 'pages' : 'dashboard')}
          onGalleryFallback={() => {
            setStep('dashboard');
            setTimeout(() => fileInputRef.current?.click(), 100);
          }}
        />
      </>
    );
  }

  if (state.step === 'scan-source') {
    return (
      <>
        {fileInputEl}
        {globalOverlays}
        <div className="fixed inset-0 bg-gray-900/80 z-50 flex flex-col items-center justify-center gap-4 p-6">
          <h2 className="text-white font-semibold text-lg">Tambah Halaman</h2>
          <button
            onClick={() => setStep('camera')}
            className="w-full max-w-xs flex items-center gap-4 p-4 bg-white rounded-2xl active:bg-gray-50"
          >
            <div className="bg-blue-600 p-3 rounded-xl">
              <Camera size={22} className="text-white" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900">Kamera</p>
              <p className="text-sm text-gray-500">Ambil foto langsung</p>
            </div>
          </button>
          <button
            onClick={() => {
              setStep('dashboard');
              setTimeout(() => fileInputRef.current?.click(), 100);
            }}
            className="w-full max-w-xs flex items-center gap-4 p-4 bg-white rounded-2xl active:bg-gray-50"
          >
            <div className="bg-green-600 p-3 rounded-xl">
              <Upload size={22} className="text-white" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900">Galeri / Upload</p>
              <p className="text-sm text-gray-500">JPG, PNG, WEBP</p>
            </div>
          </button>
          <button onClick={() => setStep('pages')} className="text-white/70 text-sm mt-2">
            Batal
          </button>
        </div>
      </>
    );
  }

  if (state.step === 'crop' && state.currentImage) {
    return (
      <>
        {fileInputEl}
        {globalOverlays}
        <CropEditor
          imageDataUrl={state.currentImage}
          initialCrop={state.currentCrop}
          onConfirm={handleCropConfirmed}
          onBack={() => setStep(state.pages.length > 0 ? 'pages' : 'dashboard')}
        />
      </>
    );
  }

  if (state.step === 'enhance' && state.pendingPage) {
    const isEditing = state.editingIndex !== null;
    return (
      <>
        {fileInputEl}
        {globalOverlays}
        <ImageEditor
          page={state.pendingPage}
          pageIndex={isEditing ? state.editingIndex! : state.pages.length}
          totalPages={isEditing ? state.pages.length : state.pages.length + 1}
          onSave={handlePageSaved}
          onBack={() => setStep(state.pages.length > 0 ? 'pages' : 'dashboard')}
        />
      </>
    );
  }

  if (state.step === 'pages') {
    return (
      <>
        {fileInputEl}
        {globalOverlays}
        <PageManager
          pages={state.pages}
          onAddPage={handleAddPage}
          onDeletePage={handleDeletePage}
          onEditPage={handleEditPage}
          onReorderPage={handleReorderPage}
          onFinish={() => setShowExport(true)}
          onBack={() => reset()}
        />
        <ExportModal
          open={showExport}
          pages={state.pages}
          documentName={state.documentName}
          onNameChange={updateDocumentName}
          onSave={handleSaveDocument}
          onClose={handleExportClose}
          onDone={handleExportDone}
        />
      </>
    );
  }

  // ─── Dashboard ───────────────────────────────────────────────────────────
  return (
    <AppShell>
      {fileInputEl}
      {globalOverlays}

      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 safe-area-pt">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-xl">
              <ScanLine size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-lg leading-none">ECamScanner</h1>
              <p className="text-xs text-gray-500">Free · No Watermark</p>
            </div>
          </div>
          {state.pages.length > 0 && (
            <button
              onClick={() => setStep('pages')}
              className="flex items-center gap-1 text-blue-600 text-sm font-medium bg-blue-50 px-3 py-1.5 rounded-full"
            >
              <FileText size={14} />
              {state.pages.length} hal.
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </header>

      {/* Main scan button */}
      <div className="px-4 pt-5 pb-4">
        <button
          onClick={handleScanButton}
          className="w-full bg-blue-600 text-white rounded-2xl p-5 flex items-center justify-between shadow-lg shadow-blue-200 active:scale-[0.98] transition-transform"
        >
          <div className="text-left">
            <p className="font-bold text-lg">
              {state.pages.length > 0 ? 'Lanjutkan Scan' : 'Mulai Scan'}
            </p>
            <p className="text-blue-200 text-sm mt-0.5">
              {state.pages.length > 0
                ? `${state.pages.length} halaman siap diekspor`
                : 'Kamera atau upload gambar'}
            </p>
          </div>
          <div className="bg-white/20 p-3 rounded-xl">
            <Camera size={28} className="text-white" />
          </div>
        </button>
      </div>

      {/* Quick actions */}
      <div className="px-4 pb-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => setStep('camera')}
          className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3 active:bg-gray-50"
        >
          <div className="bg-blue-50 p-2.5 rounded-xl">
            <Camera size={20} className="text-blue-600" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900 text-sm">Kamera</p>
            <p className="text-xs text-gray-500">Scan langsung</p>
          </div>
        </button>

        <button
          onClick={handleSelectGallery}
          className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3 active:bg-gray-50"
        >
          <div className="bg-green-50 p-2.5 rounded-xl">
            <Upload size={20} className="text-green-600" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900 text-sm">Upload</p>
            <p className="text-xs text-gray-500">Dari galeri</p>
          </div>
        </button>
      </div>

      {/* Features banner */}
      <div className="mx-4 mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="flex flex-col items-center gap-1">
            <div className="bg-white p-2 rounded-xl shadow-sm">
              <Shield size={18} className="text-blue-600" />
            </div>
            <span className="text-xs text-gray-600 font-medium">No Watermark</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="bg-white p-2 rounded-xl shadow-sm">
              <Zap size={18} className="text-yellow-500" />
            </div>
            <span className="text-xs text-gray-600 font-medium">Gratis</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="bg-white p-2 rounded-xl shadow-sm">
              <FileText size={18} className="text-green-600" />
            </div>
            <span className="text-xs text-gray-600 font-medium">Export PDF</span>
          </div>
        </div>
      </div>

      {/* Recent documents */}
      <RecentDocuments onReopen={(doc) => setReopenDoc(doc)} />
      <div className="h-6" />

      {/* Reopen document modal */}
      <Modal open={!!reopenDoc} onClose={() => setReopenDoc(null)} title={reopenDoc?.name ?? ''}>
        {reopenDoc && (
          <div className="space-y-4">
            {reopenDoc.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={reopenDoc.thumbnail}
                alt={reopenDoc.name}
                className="w-full max-h-48 object-contain rounded-xl bg-gray-100"
              />
            )}
            <p className="text-sm text-gray-600">
              {reopenDoc.pageCount} halaman · Dibuat{' '}
              {new Date(reopenDoc.createdAt).toLocaleDateString('id-ID', { dateStyle: 'long' })}
            </p>
            <Button variant="primary" size="lg" className="w-full" onClick={() => handleOpenDoc(reopenDoc)}>
              <FileText size={18} />
              Buka &amp; Ekspor
            </Button>
            <Button variant="ghost" size="md" className="w-full text-gray-500" onClick={() => setReopenDoc(null)}>
              Tutup
            </Button>
          </div>
        )}
      </Modal>

      {/* Source selection modal */}
      <Modal open={sourceModal} onClose={() => setSourceModal(false)} title="Pilih Sumber">
        <div className="space-y-3">
          <button
            onClick={handleSelectCamera}
            className="w-full flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100 hover:border-blue-300 transition-colors"
          >
            <div className="bg-blue-600 p-3 rounded-xl">
              <Camera size={22} className="text-white" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900">Kamera</p>
              <p className="text-sm text-gray-500">Ambil foto langsung</p>
            </div>
          </button>
          <button
            onClick={handleSelectGallery}
            className="w-full flex items-center gap-4 p-4 bg-green-50 rounded-xl border border-green-100 hover:border-green-300 transition-colors"
          >
            <div className="bg-green-600 p-3 rounded-xl">
              <Upload size={22} className="text-white" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900">Galeri / Upload</p>
              <p className="text-sm text-gray-500">JPG, PNG, WEBP</p>
            </div>
          </button>
        </div>
      </Modal>
    </AppShell>
  );
}
