export default function Header() {
    return (
        <header className="border-b">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                <h1 className="text-2xl font-bold">Your Brand</h1>
                <nav className="hidden md:flex gap-6">
                    <a href="#" className="hover:text-primary transition-colors">Home</a>
                    <a href="#" className="hover:text-primary transition-colors">About</a>
                    <a href="#" className="hover:text-primary transition-colors">Services</a>
                    <a href="#" className="hover:text-primary transition-colors">Contact</a>
                </nav>
            </div>
        </header>
    );
}
