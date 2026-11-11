import instaloader
import os
from datetime import datetime

class IGDownloader:
    def __init__(self):
        self.L = instaloader.Instaloader(
            download_pictures=False,
            download_videos=True,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=True,
            compress_metadata=False,
            filename_pattern='{shortcode}'
        )

    def download_by_metrics(self, profile_name, min_views=1000, min_likes=500, start_date=None, end_date=None, limit=10):
        print(f"Buscando perfil: {profile_name}...")
        profile = instaloader.Profile.from_username(self.L.context, profile_name)
        
        # Pasta de destino fixada
        target_dir = r"C:\Users\Usuário\Desktop\ECOSSISTEMA\Videos Coletor"
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)
        
        count = 0
        for post in profile.get_posts():
            if count >= limit:
                break
            
            # Filtro de Data
            if start_date and post.date_utc < start_date:
                continue
            if end_date and post.date_utc > end_date:
                continue
                
            # Filtro de Métricas (Instaloader não pega views de Reels facilmente sem login, mas pega likes)
            if post.likes < min_likes:
                continue
            
            # Se for vídeo/reel
            if post.is_video:
                print(f"Baixando post {post.shortcode} ({post.likes} likes)...")
                # Salva dentro da pasta alvo, subpasta com nome do perfil
                self.L.download_post(post, target=os.path.join(target_dir, profile_name))
                count += 1
        
        print(f"Concluído. {count} vídeos baixados para a pasta {target_dir}.")

if __name__ == "__main__":
    # Exemplo de uso manual
    # downloader = IGDownloader()
    # downloader.download_by_metrics("perfil_alvo", min_likes=1000, limit=5)
    print("Script IGDownloader pronto.")
