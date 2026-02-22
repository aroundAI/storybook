'use client';

/**
 * Edit Suite page — per-episode non-linear editor.
 *
 * Wraps the editor in EditSuiteProvider and renders the shell layout.
 * On first open, loads the existing edit project or shows a creation CTA.
 */

import { EditSuiteProvider } from '@kit/edit-suite/components';
import { EditSuiteShell } from '@kit/edit-suite/components';

export default function EditSuitePage() {
    return (
        <EditSuiteProvider>
            <EditSuiteShell />
        </EditSuiteProvider>
    );
}
