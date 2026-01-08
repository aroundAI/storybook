export default function PublicLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
            <header className="sticky top-0 z-50 w-full border-b backdrop-blur bg-white/95 supports-[backdrop-filter]:bg-white/60">
                <div className="container px-4 h-14 flex items-center justify-between mx-auto">
                    <div className="font-bold">
                        {/* Logo or Brand Name */}
                        <a href="/" className="flex items-center gap-2">
                            <span>StoryBook</span>
                        </a>
                    </div>

                    <div className="flex items-center gap-4">
                        <a href="/auth/sign-in" className="text-sm font-medium hover:underline">
                            Sign In
                        </a>
                    </div>
                </div>
            </header>
            <main className="flex-1 flex flex-col">
                {children}
            </main>
            <footer className="py-6 md:px-8 md:py-0 border-t bg-white">
                <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row mx-auto px-4">
                    <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
                        Powered by StoryBook
                    </p>
                </div>
            </footer>
        </div>
    );
}
