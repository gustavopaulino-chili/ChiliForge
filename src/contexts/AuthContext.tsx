import { createContext, useContext, useEffect, useState } from "react";

type User = {
  id: number;
  email: string;
  name: string;
  accountType: "admin" | "testing";
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signIn: (userData: User) => void;
  signOut: () => void;
  continueWithoutLogin: () => void;
  isGuest: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeAccountType = (value: unknown): User["accountType"] =>
  value === "admin" ? "admin" : "testing";

const createGuestUser = (): User => ({
  id: 999,
  email: "guest@example.com",
  name: "Guest User",
  accountType: "testing",
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  // ✅ runs only ONCE
  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const storedIsGuest = localStorage.getItem("isGuest");

    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      const hydratedUser: User = {
        id: parsedUser.id,
        email: parsedUser.email,
        name: parsedUser.name,
        accountType: normalizeAccountType(parsedUser.accountType),
      };
      setUser(hydratedUser);
      localStorage.setItem("user", JSON.stringify(hydratedUser));
    }

    if (storedIsGuest === "true") {
      setIsGuest(true);
      if (!storedUser) {
        const guestUser = createGuestUser();
        setUser(guestUser);
        localStorage.setItem("user", JSON.stringify(guestUser));
      }
    }

    setLoading(false);
  }, []);

  const signIn = (userData: User) => {
    const normalizedUser = {
      ...userData,
      accountType: normalizeAccountType(userData.accountType),
    };
    localStorage.setItem("user", JSON.stringify(normalizedUser));
    localStorage.removeItem("isGuest");
    setUser(normalizedUser);
    setIsGuest(false);
  };

  const signOut = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("isGuest");
    setUser(null);
    setIsGuest(false);
  };

  const continueWithoutLogin = () => {
    const guestUser = createGuestUser();

    localStorage.setItem("user", JSON.stringify(guestUser));
    localStorage.setItem("isGuest", "true");
    setUser(guestUser);
    setIsGuest(true);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, continueWithoutLogin, isGuest }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};