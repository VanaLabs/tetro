'use client'

import { DeletedDraftCleanup } from '@/components/tetro/DeletedDraftCleanup'
import { StartupGuard } from '@/components/tetro/StartupGuard'
import { NativeActions } from '@/components/tetro/NativeActions'
import { ModelActivationBridge } from '@/components/tetro/ModelActivationBridge'
import { TetroIdentityBridge } from '@/components/tetro/TetroBrand'
import { MarkWatch, SilenceWatch } from '@/components/tetro/RecordingLevels'
import { HoverHints } from '@/components/tetro/HoverHints'
import './globals.css'
import './tetro.css'
import './glass.css'
import { NativeGlass } from '@/components/tetro/NativeGlass'
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import Sidebar from '@/components/tetro/TetroSidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import { Toaster, toast } from 'sonner'
import "sonner/dist/styles.css"
import { useState, useEffect, useCallback } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/onboarding'
import { loadBetaFeatures } from '@/types/betaFeatures'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { ImportAudioDialog, ImportDropOverlay } from '@/components/ImportAudio'
import { ImportDialogProvider } from '@/contexts/ImportDialogContext'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'

const sourceSans3 = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-tetro',
})

// Timecodes, counters and small hardware-style labels.
const tetroMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-tetro-mono',
})

// Module-level component — stable reference across RootLayout re-renders.
// Defined here (not inside RootLayout) so React never sees a new function type
// on re-render, which would cause unmount/remount and break initialization logic.
function ConditionalImportDialog({
  showImportDialog,
  handleImportDialogClose,
  importFilePath,
}: {
  showImportDialog: boolean;
  handleImportDialogClose: (open: boolean) => void;
  importFilePath: string | null;
}) {
  const { betaFeatures } = useConfig();

  // Unmount on close so its backdrop cannot linger over the app.
  if (!betaFeatures.importAndRetranscribe || !showImportDialog) {
    return null;
  }

  return (
    <ImportAudioDialog
      open={showImportDialog}
      onOpenChange={handleImportDialogClose}
      preselectedFile={importFilePath}
    />
  );
}

function ThemedToaster() {
  const { theme } = useTheme();

  return <Toaster theme={theme} position="bottom-right" offset="24px" closeButton toastOptions={{ className: 'tetro-toast' }} />;
}

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)

  // Import audio state
  const [showDropOverlay, setShowDropOverlay] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  useEffect(() => {
    const preventNativeMenu = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('contextmenu', preventNativeMenu, true)
    return () => document.removeEventListener('contextmenu', preventNativeMenu, true)
  }, [])

  useEffect(() => {
    // Check onboarding status first
    invoke<{ completed: boolean } | null>('get_onboarding_status')
      .then((status) => {
        const isComplete = status?.completed ?? false
        setOnboardingCompleted(isComplete)

        if (!isComplete) {
          console.log('[Layout] Onboarding not completed, showing onboarding flow')
          setShowOnboarding(true)
        } else {
          console.log('[Layout] Onboarding completed, showing main app')
        }
      })
      .catch((error) => {
        console.error('[Layout] Failed to check onboarding status:', error)
        // Default to showing onboarding if we can't check
        setShowOnboarding(true)
        setOnboardingCompleted(false)
      })
  }, [])

  useEffect(() => {
    // Listen for tray recording toggle request
    const unlisten = listen('request-recording-toggle', () => {
      console.log('[Layout] Received request-recording-toggle from tray');

      if (showOnboarding) {
        toast.error("Please complete setup first", {
          description: "You need to finish onboarding before you can start recording."
        });
      } else {
        // If in main app, forward to useRecordingStart via window event
        console.log('[Layout] Forwarding to start-recording-from-sidebar');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [showOnboarding]);

  // Handle file drop for audio import
  const handleFileDrop = useCallback((paths: string[]) => {
    // Check if beta features are enabled (read from localStorage directly since we're outside ConfigProvider)
    const betaFeatures = loadBetaFeatures();

    if (!betaFeatures.importAndRetranscribe) {
      toast.error('Beta feature disabled', {
        description: 'Enable "Import audio & retranscribe" in Settings > Beta to use this feature.'
      });
      return;
    }

    // Find the first audio file
    const audioFile = paths.find(p => {
      const ext = p.split('.').pop()?.toLowerCase();
      return !!ext && isAudioExtension(ext);
    });

    if (audioFile) {
      console.log('[Layout] Audio file dropped:', audioFile);
      setImportFilePath(audioFile);
      setShowImportDialog(true);
    } else if (paths.length > 0) {
      toast.error('Please drop an audio file', {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`
      });
    }
  }, []);

  // Listen for drag-drop events
  useEffect(() => {
    if (showOnboarding) return; // Don't handle drops during onboarding

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Native drag events also fire for blocks dragged inside the summary editor.
      // Only file drags have paths, so ignore editor-only drags here.
      const unlistenDragEnter = await listen<{ paths: string[] }>('tauri://drag-enter', (event) => {
        if (event.payload.paths?.length && loadBetaFeatures().importAndRetranscribe) {
          setShowDropOverlay(true);
        }
      });
      if (cleanedUpRef.current) {
        unlistenDragEnter();
        return;
      }
      unlisteners.push(unlistenDragEnter);

      // Drag leave - hide overlay
      const unlistenDragLeave = await listen('tauri://drag-leave', () => {
        setShowDropOverlay(false);
      });
      if (cleanedUpRef.current) {
        unlistenDragLeave();
        unlisteners.splice(0).forEach(u => u());
        return;
      }
      unlisteners.push(unlistenDragLeave);

      // Drop - process files
      const unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setShowDropOverlay(false);
        if (event.payload.paths?.length) handleFileDrop(event.payload.paths);
      });
      if (cleanedUpRef.current) {
        unlistenDrop();
        unlisteners.splice(0).forEach(u => u());
        return;
      }
      unlisteners.push(unlistenDrop);
    };

    void setupListeners().catch(error => console.error('Couldn’t register file-drop listeners:', error));

    return () => {
      cleanedUpRef.current = true;
      unlisteners.splice(0).forEach((unlisten) => unlisten());
    };
  }, [showOnboarding, handleFileDrop]);

  // Handle import dialog close
  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open);
    if (!open) {
      setImportFilePath(null);
    }
  }, []);

  // Handler for ImportDialogProvider - opens import dialog from any child component
  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null);
    setShowImportDialog(true);
  }, []);

  const handleOnboardingComplete = () => {
    console.log('[Layout] Onboarding completed, reloading app')
    setShowOnboarding(false)
    setOnboardingCompleted(true)
    // Optionally reload the window to ensure all state is fresh
    window.location.reload()
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = window.localStorage.getItem('tetro-theme') || window.localStorage.getItem('meetily-theme');
                if (t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch {}
            `,
          }}
        />
      </head>
      <body className={`${sourceSans3.variable} ${tetroMono.variable} font-sans antialiased tetro-app`}>
        <StartupGuard><ThemeProvider>
          <NativeGlass />
          <DeletedDraftCleanup />
            <RecordingStateProvider>
              <TetroIdentityBridge />
              <SilenceWatch />
              <HoverHints />
              <MarkWatch />
              <TranscriptProvider>
                <ConfigProvider>
                  <ModelActivationBridge />
                  <OllamaDownloadProvider>
                    <OnboardingProvider>
                      <UpdateCheckProvider>
                        <SidebarProvider>
                          <TooltipProvider>
                            <RecordingPostProcessingProvider>
                              <ImportDialogProvider onOpen={handleOpenImportDialog}>
                                <NativeActions />
                                {/* Download progress toast provider - listens for background downloads */}
                                <DownloadProgressToastProvider />

                                {/* Show onboarding or main app */}
                                {showOnboarding ? (
                                  <OnboardingFlow onComplete={handleOnboardingComplete} />
                                ) : (
                                  <div className="tetro-shell">
                                    <Sidebar />
                                    <MainContent>{children}</MainContent>
                                  </div>
                                )}
                                {/* Import audio overlay and dialog */}
                                <ImportDropOverlay visible={showDropOverlay} />
                                <ConditionalImportDialog
                                  showImportDialog={showImportDialog}
                                  handleImportDialogClose={handleImportDialogClose}
                                  importFilePath={importFilePath}
                                />
                              </ImportDialogProvider>
                            </RecordingPostProcessingProvider>
                          </TooltipProvider>
                        </SidebarProvider>
                      </UpdateCheckProvider>
                    </OnboardingProvider>

                  </OllamaDownloadProvider>
                </ConfigProvider>
              </TranscriptProvider>
            </RecordingStateProvider>

          <ThemedToaster />
        </ThemeProvider></StartupGuard>
      </body>
    </html>
  )
}
