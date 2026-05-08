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
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeAccountType = (value: unknown): User["accountType"] =>
  value === "admin" ? "admin" : "testing";

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");

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

    setLoading(false);
  }, []);

  const signIn = (userData: User) => {
    const normalizedUser = {
      ...userData,
      accountType: normalizeAccountType(userData.accountType),
    };
    localStorage.setItem("user", JSON.stringify(normalizedUser));
    setUser(normalizedUser);
  };

  const signOut = () => {
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
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