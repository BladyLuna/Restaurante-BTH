import 'react-native-get-random-values';
import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {SessionProvider} from '../shared/api/session';
import {BrandingProvider} from '../shared/api/branding';
import {UiProvider, useUi} from '../shared/ui';

/** Dentro del UiProvider: el fondo y la barra de estado siguen al tema activo. */
function Marco() {
  const {colors, modo} = useUi();
  return (
    <SafeAreaView style={{flex: 1, backgroundColor: colors.bg}}>
      <StatusBar style={modo === 'oscuro' ? 'light' : 'dark'} />
      <Stack screenOptions={{headerShown: false, contentStyle: {backgroundColor: colors.bg}}} />
    </SafeAreaView>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <UiProvider>
        <SessionProvider>
          {/* Dentro de SessionProvider: el branding usa la misma apiUrl que ya
              resolvio la sesion, en vez de volver a leerla del storage. */}
          <BrandingProvider>
            <Marco />
          </BrandingProvider>
        </SessionProvider>
      </UiProvider>
    </SafeAreaProvider>
  );
}
