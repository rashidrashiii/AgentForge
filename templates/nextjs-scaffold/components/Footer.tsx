export default function Footer() {
    return (
        <footer className="border-t mt-auto">
            <div className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div>
                        <h3 className="font-semibold mb-4">About</h3>
                        <p className="text-sm text-muted-foreground">
                            Your company description goes here.
                        </p>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-4">Links</h3>
                        <ul className="space-y-2 text-sm">
                            <li><a href="#" className="text-muted-foreground hover:text-foreground">Home</a></li>
                            <li><a href="#" className="text-muted-foreground hover:text-foreground">About</a></li>
                            <li><a href="#" className="text-muted-foreground hover:text-foreground">Contact</a></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-4">Contact</h3>
                        <p className="text-sm text-muted-foreground">
                            Email: info@example.com
                        </p>
                    </div>
                </div>
                <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
                    © {new Date().getFullYear()} Your Company. All rights reserved.
                </div>
            </div>
        </footer>
    );
}
